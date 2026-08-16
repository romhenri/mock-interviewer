import type { Feedback, Score, ScoreSlot } from "./types";

export const CRITERIA = ["correctness", "english", "depth"] as const;

export type Criterion = (typeof CRITERIA)[number];

/**
 * Validates a judge response. The strict JSON schema guarantees the shape but
 * not the range — providers routinely ignore `minimum`/`maximum` — so the
 * bounds are checked here. Throws rather than clamping: an out-of-range score
 * means the judge misbehaved, and silently rounding it to 100 would hide that.
 *
 * @param reference the full-credit answer the question was generated with. When
 * present it is what the judge scored against, so it is also what the candidate
 * is shown — the judge was not asked to write a second one.
 */
export function parseScore(raw: unknown, reference?: string | null): Score {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Judge returned no score object.");
  }
  const candidate = raw as Record<string, unknown>;

  const scores = {} as Record<Criterion, number>;
  for (const criterion of CRITERIA) {
    const value = candidate[criterion];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`Judge returned an invalid ${criterion} score: ${JSON.stringify(value)}`);
    }
    scores[criterion] = value;
  }
  // Feedback is per criterion, so a line can sit under the number it explains.
  const rawFeedback = (candidate.feedback ?? {}) as Record<string, unknown>;
  const feedback = {} as Feedback;
  for (const criterion of CRITERIA) {
    const line = rawFeedback[criterion];
    if (typeof line !== "string" || !line.trim()) {
      throw new Error(`Judge returned no ${criterion} feedback.`);
    }
    feedback[criterion] = line;
  }
  const suggestedAnswer = reference?.trim() || candidate.suggestedAnswer;
  if (typeof suggestedAnswer !== "string" || !suggestedAnswer.trim()) {
    throw new Error("Judge returned no suggested answer.");
  }

  return { ...scores, feedback, suggestedAnswer };
}

/** Narrows a stored slot to a real score — excludes skipped, pending and failed. */
export function isScore(slot: ScoreSlot): slot is Score {
  return slot !== null && !("error" in slot);
}

/**
 * Mean of each criterion across every scored answer, rounded to whole points.
 * Skipped, pending and failed slots are excluded from both the total and the
 * divisor — counting them as zero would punish skipping, or a network error, as
 * if it were a wrong answer.
 */
export function averageScores(scores: ScoreSlot[]): Record<Criterion, number> {
  const answered = scores.filter(isScore);
  const averages = {} as Record<Criterion, number>;
  for (const criterion of CRITERIA) {
    const total = answered.reduce((sum, score) => sum + score[criterion], 0);
    averages[criterion] = answered.length ? Math.round(total / answered.length) : 0;
  }
  return averages;
}
