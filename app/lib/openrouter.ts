const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-20b:free";

/**
 * Free models that support strict structured output, ordered by measured
 * response time on the shared free pool (Aug 2026): gemma ~5s, nemotron-super
 * ~17s, gpt-oss ~18s, nemotron-nano ~37s. The chain is tried in order, so the
 * fastest survivor answers first.
 */
const FALLBACK_MODELS = [
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-20b:free",
  "nvidia/nemotron-nano-9b-v2:free",
];

/**
 * Total wall-clock budget for the whole chain, not per attempt. Rate-limited
 * models reject in milliseconds, so a fixed per-attempt timeout let a chain of
 * slow models keep someone waiting for minutes. Capping the total instead means
 * cheap failures cost nothing and the worst case stays bounded however many
 * models are tried.
 */
const TOTAL_BUDGET_MS = 75_000;

/** No single model may eat the entire budget and starve the rest of the chain. */
const PER_ATTEMPT_CAP_MS = 35_000;

/** A failure the chain cannot fix, so trying further models is pointless. */
class FatalError extends Error {}

/** The configured model first, then the rest of the chain, no duplicates. */
function modelChain(): string[] {
  const primary = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  return [primary, ...FALLBACK_MODELS.filter((model) => model !== primary)];
}

/**
 * Calls OpenRouter with a forced JSON schema, falling through the model chain
 * on timeout, rate limit or malformed output.
 *
 * The free pool is shared and routinely rate-limits or queues past 30s, so a
 * single-model call fails often enough to be unusable. Falling back changes
 * which model answered — `served` reports it, because a score is only
 * comparable against others from the same judge.
 */
export async function chatJSON(
  prompt: string,
  schema: { name: string; schema: object },
): Promise<{ content: unknown; served: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Copy app/.env.local.example to app/.env.local and add your key.",
    );
  }

  const failures: string[] = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (const model of modelChain()) {
    const remaining = deadline - Date.now();
    if (remaining <= 1_000) {
      failures.push(`${model}: skipped, ${TOTAL_BUDGET_MS / 1000}s budget spent`);
      break;
    }

    try {
      const timeout = Math.min(remaining, PER_ATTEMPT_CAP_MS);
      return { content: await callModel(apiKey, model, prompt, schema, timeout), served: model };
    } catch (error) {
      if (error instanceof FatalError) throw error;
      failures.push(`${model}: ${(error as Error).message}`);
    }
  }

  throw new Error(
    `Every free model failed or was rate-limited. ${failures.join(" | ")}. ` +
      `The free pool is shared and heavily contended — adding credits at ` +
      `https://openrouter.ai/settings/credits or your own provider key at ` +
      `https://openrouter.ai/settings/integrations removes this.`,
  );
}

async function callModel(
  apiKey: string,
  model: string,
  prompt: string,
  schema: { name: string; schema: object },
  timeoutMs: number,
): Promise<unknown> {
  // The signal aborts the body read as well as the request, so the whole call
  // is wrapped — translating only around fetch() let the raw DOMException
  // ("The operation was aborted due to timeout") escape from response.json().
  try {
    return await attempt();
  } catch (error) {
    if ((error as Error).name === "TimeoutError") {
      throw new Error(`no response within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  }

  async function attempt(): Promise<unknown> {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: {
          type: "json_schema",
          json_schema: { name: schema.name, strict: true, schema: schema.schema },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      // A rejected key fails identically on every model, so walking the chain
      // just repeats the same message for each one.
      if (response.status === 401 || response.status === 403) {
        throw new FatalError(`OpenRouter rejected the API key (HTTP ${response.status}).`);
      }
      throw new Error(`HTTP ${response.status}: ${detail.slice(0, 160)}`);
    }

    const body = await response.json();

    // OpenRouter reports upstream failures as HTTP 200 with an error object in
    // the body, so response.ok above is not enough.
    if (body?.error) {
      const { code, message, metadata } = body.error;
      const detail = metadata?.provider_error_code ?? message ?? JSON.stringify(body.error);
      const retry = metadata?.retry_after_seconds;
      throw new Error(`${code ?? "error"} ${detail}${retry ? ` (retry in ${retry}s)` : ""}`);
    }

    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      const finish = body?.choices?.[0]?.finish_reason;
      throw new Error(
        `no message content${finish ? ` (finish_reason: ${finish})` : ""}: ` +
          JSON.stringify(body).slice(0, 160),
      );
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new Error(`invalid JSON: ${content.slice(0, 160)}`);
    }
  }
}
