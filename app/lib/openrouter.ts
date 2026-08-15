import { FREE_MODELS } from "./models.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-20b:free";

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

/**
 * The chosen model first, then the rest of the chain, no duplicates. `preferred`
 * comes from the browser, so it is checked against the known list rather than
 * forwarded — it ends up in an outbound API call.
 */
function modelChain(preferred?: string): string[] {
  const wanted = FREE_MODELS.includes(preferred as (typeof FREE_MODELS)[number]) ? preferred : null;
  const primary = wanted || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  return [primary, ...FREE_MODELS.filter((model) => model !== primary)];
}

/**
 * Calls OpenRouter with a forced JSON schema, falling through the model chain
 * on timeout, rate limit or malformed output.
 *
 * The free pool is shared and routinely rate-limits or queues past 30s, so a
 * single-model call fails often enough to be unusable. Falling back changes
 * which model answered — `served` reports it, because a score is only
 * comparable against others from the same judge.
 *
 * @param parse turns the raw JSON into what the caller needs, and throwing is how
 * it rejects a model. Free models ignore the schema often enough that this has to
 * run inside the chain: validated afterwards, one model's malformed answer failed
 * the whole request while three working models sat untried.
 */
export async function chatJSON<T = unknown>(
  prompt: string,
  schema: { name: string; schema: object },
  userApiKey?: string,
  parse: (content: unknown) => T = (content) => content as T,
  preferredModel?: string,
): Promise<{ content: T; served: string }> {
  const apiKey = userApiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Copy app/.env.local.example to app/.env.local and add your key.",
    );
  }

  const failures: string[] = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (const model of modelChain(preferredModel)) {
    const remaining = deadline - Date.now();
    if (remaining <= 1_000) {
      failures.push(`${model}: skipped, ${TOTAL_BUDGET_MS / 1000}s budget spent`);
      break;
    }

    try {
      const timeout = Math.min(remaining, PER_ATTEMPT_CAP_MS);
      const raw = await callModel(apiKey, model, prompt, schema, timeout);
      return { content: parse(raw), served: model };
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
