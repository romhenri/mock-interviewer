const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-20b:free";

/**
 * Calls OpenRouter with a forced JSON schema and returns the parsed content.
 *
 * Throws on every failure path rather than returning a partial result — a
 * fabricated score is worse than a visible error. See TICKETS.md 03.
 */
export async function chatJSON(
  prompt: string,
  schema: { name: string; schema: object },
): Promise<unknown> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Copy app/.env.local.example to app/.env.local and add your key.",
    );
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    // Free-tier calls can queue for a long time; without this a stalled
    // request holds the route open until the platform kills it.
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: { name: schema.name, strict: true, schema: schema.schema },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenRouter returned ${response.status}: ${detail.slice(0, 300)}`);
  }

  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenRouter response contained no message content.");
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Model did not return valid JSON: ${content.slice(0, 300)}`);
  }
}
