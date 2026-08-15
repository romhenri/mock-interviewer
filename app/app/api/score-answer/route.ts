import { chatJSON } from "@/lib/openrouter";
import { judgePrompt, scoreSchema } from "@/lib/prompts";
import { parseScore } from "@/lib/score";

export async function POST(request: Request) {
  let question: unknown;
  let answer: unknown;
  let reference: unknown;
  try {
    ({ question, answer, reference } = await request.json());
  } catch {
    return Response.json({ error: "Request body was not valid JSON." }, { status: 400 });
  }

  if (typeof question !== "string" || typeof answer !== "string" || !answer.trim()) {
    return Response.json(
      { error: "A question and a non-empty answer are required." },
      { status: 400 },
    );
  }

  // The question was generated with the answer it expects; scoring against that is
  // both cheaper and steadier than having each judge invent its own bar.
  const bar = typeof reference === "string" && reference.trim() ? reference : null;

  try {
    const { content, served } = await chatJSON(
      judgePrompt(question, answer, bar),
      scoreSchema(bar === null),
      request.headers.get("x-openrouter-key") ?? undefined,
      // Inside the chain, so a judge that returns nonsense is retried on the next model.
      (raw) => parseScore(raw, bar),
      request.headers.get("x-openrouter-model") ?? undefined,
    );
    return Response.json({ score: { ...content, model: served } });
  } catch (error) {
    // No retry and no fallback parsing: a score invented from a broken
    // response would be indistinguishable from a real one in the summary.
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
