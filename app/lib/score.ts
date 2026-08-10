import type { Score, ScoreSlot } from "./types";

export const CRITERIA = ["correctness", "clarity", "depth"] as const;

export type Criterion = (typeof CRITERIA)[number];

/**
 * Validates a judge response. The strict JSON schema guarantees the shape but
 * not the range — providers routinely ignore `minimum`/`maximum` — so the
 * bounds are checked here. Throws rather than clamping: an out-of-range score
 * means the judge misbehaved, and silently rounding it to 100 would hide that.
 */
export function parseScore(raw: unknown): Score {
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
  if (typeof candidate.feedback !== "string" || !candidate.feedback.trim()) {
    throw new Error("Judge returned no feedback.");
  }
  if (typeof candidate.suggestedAnswer !== "string" || !candidate.suggestedAnswer.trim()) {
    throw new Error("Judge returned no suggested answer.");
  }

  return {
    ...scores,
    feedback: candidate.feedback,
    suggestedAnswer: candidate.suggestedAnswer,
  };
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
