import { chatJSON } from "@/lib/openrouter";
import { QUESTION_COUNT, questionsPrompt, questionsSchema } from "@/lib/prompts";
import { ROLES, SUBJECTS, type Role } from "@/lib/types";

export async function POST(request: Request) {
  let role: unknown;
  let subjects: unknown;
  try {
    ({ role, subjects } = await request.json());
  } catch {
    return Response.json({ error: "Request body was not valid JSON." }, { status: 400 });
  }

  if (!ROLES.includes(role as Role)) {
    return Response.json({ error: `Unknown role: ${role}` }, { status: 400 });
  }

  // Subjects land in the prompt, so anything not on the role's own list is dropped.
  const allowed = SUBJECTS[role as Role];
  const chosen = Array.isArray(subjects) ? allowed.filter((s) => subjects.includes(s)) : [];

  try {
    const result = await chatJSON(questionsPrompt(role as Role, chosen), questionsSchema);
    const questions = (result as { questions?: unknown })?.questions;

    if (!Array.isArray(questions) || !questions.every((q) => typeof q === "string" && q.trim())) {
      throw new Error("Model returned a malformed question list.");
    }
    if (questions.length < QUESTION_COUNT) {
      throw new Error(`Model returned ${questions.length} questions, expected ${QUESTION_COUNT}.`);
    }

    return Response.json({ questions: questions.slice(0, QUESTION_COUNT) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
