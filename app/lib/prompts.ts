import type { Role } from "./types";

export const QUESTION_COUNT = 3;

export const questionsSchema = {
  name: "interview_questions",
  schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: { type: "string" },
        minItems: QUESTION_COUNT,
        maxItems: QUESTION_COUNT,
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
};

export function questionsPrompt(role: Role): string {
  return `You are a senior technical interviewer hiring for a ${role} position.

Write exactly ${QUESTION_COUNT} interview questions for this role.

Rules:
- Each question must be answerable in a few paragraphs of prose, with no code or diagrams.
- Cover different areas of the role — do not ask three variations of the same question.
- Aim at a mid-to-senior candidate: open-ended enough to reveal depth, specific enough to be answerable.
- Return only the questions themselves, with no numbering or preamble.`;
}

export const scoreSchema = {
  name: "answer_score",
  schema: {
    type: "object",
    properties: {
      correctness: { type: "integer", minimum: 0, maximum: 100 },
      clarity: { type: "integer", minimum: 0, maximum: 100 },
      depth: { type: "integer", minimum: 0, maximum: 100 },
      feedback: { type: "string" },
    },
    required: ["correctness", "clarity", "depth", "feedback"],
    additionalProperties: false,
  },
};

export function judgePrompt(question: string, answer: string): string {
  return `You are a strict but fair technical interviewer scoring a candidate's spoken answer.

QUESTION:
${question}

CANDIDATE'S ANSWER:
${answer}

Score the answer on three independent criteria, each from 0 to 100:
- correctness: is what they said technically accurate? Penalise wrong claims, not gaps.
- clarity: is it well structured and easy to follow? Judge the communication, not the content.
- depth: how completely does it cover the question? Penalise gaps, not wrong claims.

Score the criteria independently — a clear but wrong answer scores high on clarity and low on
correctness. Judge only what the candidate actually said; do not credit knowledge they did not show.

Then write two or three sentences of feedback: what was strong, and the single most valuable thing
they left out.`;
}
