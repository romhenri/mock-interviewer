import { chatJSON } from "@/lib/openrouter";
import { judgePrompt, scoreSchema } from "@/lib/prompts";
import { parseScore } from "@/lib/score";

export async function POST(request: Request) {
  let question: unknown;
  let answer: unknown;
  try {
    ({ question, answer } = await request.json());
  } catch {
    return Response.json({ error: "Request body was not valid JSON." }, { status: 400 });
  }

  if (typeof question !== "string" || typeof answer !== "string" || !answer.trim()) {
    return Response.json(
      { error: "A question and a non-empty answer are required." },
      { status: 400 },
    );
  }

  try {
    const { content, served } = await chatJSON(
      judgePrompt(question, answer),
      scoreSchema,
      request.headers.get("x-openrouter-key") ?? undefined,
    );
    return Response.json({ score: { ...parseScore(content), model: served } });
  } catch (error) {
    // No retry and no fallback parsing: a score invented from a broken
    // response would be indistinguishable from a real one in the summary.
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
