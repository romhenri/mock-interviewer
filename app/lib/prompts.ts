import type { Level, Role } from "./types";

export const QUESTION_COUNT = 3;

/**
 * Each item carries the model answer alongside the question. Writing it here costs
 * nothing extra — the generator already knows what it is asking — and it gives the
 * judge a reference to score against instead of inventing one per answer.
 */
export const questionsSchema = {
  name: "interview_questions",
  schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: { question: { type: "string" }, answer: { type: "string" } },
          required: ["question", "answer"],
          additionalProperties: false,
        },
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

Write exactly ${QUESTION_COUNT} interview questions for this role, each with the answer you
would accept as full credit.

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

For every question, also write the answer. It is the answer you would give full credit to,
and it must fit the same ${ANSWER_LENGTH} the candidate has — it shows what a complete answer
looks like at that length. Write it the way a candidate would say it out loud, not as advice
about what to say. Name the actual mechanism; an answer that restates the question in other
words is not a full-credit answer. A question whose own answer comes out vague is a bad
question — replace it.

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

/**
 * @param withSuggestedAnswer only when the question came without a reference answer —
 * older cached questions predate them. Asking for one the caller already has wastes tokens on
 * output nobody reads.
 */
export function scoreSchema(withSuggestedAnswer: boolean) {
  const criteria = { type: "integer", minimum: 0, maximum: 100 };
  const line = { type: "string" };
  const suggested = withSuggestedAnswer ? { suggestedAnswer: { type: "string" } } : {};

  return {
    name: "answer_score",
    schema: {
      type: "object",
      properties: {
        correctness: criteria,
        english: criteria,
        depth: criteria,
        feedback: {
          type: "object",
          properties: { correctness: line, english: line, depth: line },
          required: ["correctness", "english", "depth"],
          additionalProperties: false,
        },
        ...suggested,
      },
      required: ["correctness", "english", "depth", "feedback", ...Object.keys(suggested)],
      additionalProperties: false,
    },
  };
}

/** @param reference the full-credit answer written when the question was generated. */
export function judgePrompt(question: string, answer: string, reference?: string | null): string {
  return `You are a strict but fair technical interviewer scoring a candidate's spoken answer.

QUESTION:
${question}
${reference ? `\nFULL-CREDIT ANSWER (written by the interviewer who set the question):\n${reference}\n` : ""}
CANDIDATE'S ANSWER:
${answer}

This is a spoken answer of ${ANSWER_LENGTH}, not an essay. A complete answer is short. Judge it
against what a strong candidate could say in that time, never against everything that could be
said about the topic.
${
  reference
    ? `
The full-credit answer above is the bar. An answer that reaches it scores 100 — nothing beyond it
is required. Wording need not match: credit the same mechanism said differently, and credit a
correct point the full-credit answer happens to miss.
`
    : ""
}
Score the answer on three independent criteria, each from 0 to 100:
- correctness: is what they said technically accurate? Penalise wrong claims, not gaps.
- english: how well is it expressed in English? Judge grammar, word choice, idiom and fluency —
  the language only, never the technical content. Many candidates are not native speakers; score
  what would hold up in a real interview conducted in English. Understandable English with small
  errors scores well; broken word order, wrong tenses or vocabulary that obscures the meaning
  scores badly. Never lower this for a wrong or thin answer that is expressed in good English.
- depth: did they name the mechanism that actually answers the question, or only restate it in
  other words? Penalise vagueness and hand-waving — never brevity. Two sentences that name the
  right mechanism score higher than a long answer that circles it.

Score the criteria independently — a wrong answer in fluent English scores high on english and low
on correctness, and a correct answer in broken English scores the reverse. Judge only what the candidate actually said; do not credit knowledge they did not show.

Then write feedback as one line per criterion, each one or two sentences, explaining the number you
gave that criterion and nothing else:
- feedback.correctness: what was right, and the wrong claim that cost them, if any.
- feedback.english: the language only. Quote the phrase that was off and give the natural version —
  "You said 'devluper'; the word is 'developer'." If the English was clean, say that in one line.
- feedback.depth: the single most valuable mechanism they left out, or that they named it.

Keep each line about its own criterion — never mention missing content under english, or grammar
under correctness. Do not tell them to write more.
${
  reference
    ? ""
    : `
Finally, write suggestedAnswer: the answer you were scoring against. It must be a model answer to
the question in ${ANSWER_LENGTH} — the same budget the candidate had, so they can see what a full
credit answer looks like at that length. Write it as a candidate would say it, not as advice about
what to say. Do not mention the candidate or their answer in it.`
}`;
}
