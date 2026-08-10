import type { Level, Role } from "./types";

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

/** Answers are typed under time pressure, so questions must fit this budget. */
export const ANSWER_LENGTH = "2–3 sentences";

/** @param subjects narrows the questions; empty means the whole role is fair game. */
export function questionsPrompt(role: Role, level: Level, subjects: string[] = []): string {
  const coverage = subjects.length
    ? `Every question must be about one of these subjects: ${subjects.join(", ")}. Use a
  different subject from that list for each question where there are enough of them.`
    : `Cover ${QUESTION_COUNT} different areas of the role.`;

  return `You are a senior technical interviewer hiring for a ${level}-level ${role} position.

Write exactly ${QUESTION_COUNT} interview questions for this role.

Pitch every question at the ${level} level: ask what someone at that level is expected to know, and
nothing beyond it. A ${level} candidate who knows their job should be able to answer all three.

The candidate answers out loud, in ${ANSWER_LENGTH}. Every question must be fully
answerable in that space by someone who knows the material.

Rules:
- Ask about ONE concept per question. Never join two questions with "and" — "What is X, and
  how does it differ from Y?" is two questions and does not fit the length budget.
- Prefix each question with a short topic label, then a colon.
- Be specific. Name the actual technology, pattern or failure mode. A question that could
  appear in any interview for any role is a bad question.
- ${coverage}
- No code, no diagrams, no "walk me through your experience with…" biography questions.
- Return only the questions, with no numbering or preamble.

Good examples of the shape and scope:
- "Reverse Proxy: What is the primary function of a reverse proxy in a system architecture?"
- "Cache Invalidation: What is a cache stampede, and what triggers it?"
- "Connection Management: Why do application servers handling thousands of concurrent
  requests need connection pooling?"

Bad — too broad to answer in ${ANSWER_LENGTH}:
- "Explain the inner workings and appropriate use cases for Cache-Aside, Read-Through and
  Write-Through caching patterns."
- "How do consensus algorithms like Raft or Paxos solve leader election, and what are the
  trade-offs between them?"`;
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
      suggestedAnswer: { type: "string" },
    },
    required: ["correctness", "clarity", "depth", "feedback", "suggestedAnswer"],
    additionalProperties: false,
  },
};

export function judgePrompt(question: string, answer: string): string {
  return `You are a strict but fair technical interviewer scoring a candidate's spoken answer.

QUESTION:
${question}

CANDIDATE'S ANSWER:
${answer}

This is a spoken answer of ${ANSWER_LENGTH}, not an essay. A complete answer is short. Judge it
against what a strong candidate could say in that time, never against everything that could be
said about the topic.

Score the answer on three independent criteria, each from 0 to 100:
- correctness: is what they said technically accurate? Penalise wrong claims, not gaps.
- clarity: is it well structured and easy to follow? Judge the communication, not the content.
- depth: did they name the mechanism that actually answers the question, or only restate it in
  other words? Penalise vagueness and hand-waving — never brevity. Two sentences that name the
  right mechanism score higher than a long answer that circles it.

Score the criteria independently — a clear but wrong answer scores high on clarity and low on
correctness. Judge only what the candidate actually said; do not credit knowledge they did not show.

Then write two or three sentences of feedback: what was strong, and the single most valuable thing
they left out. Do not tell them to write more.

Finally, write suggestedAnswer: the answer you were scoring against. It must be a model answer to
the question in ${ANSWER_LENGTH} — the same budget the candidate had, so they can see what a full
credit answer looks like at that length. Write it as a candidate would say it, not as advice about
what to say. Do not mention the candidate or their answer in it.`;
}
