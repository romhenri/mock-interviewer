import type { Score } from "./types";

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

  return { ...scores, feedback: candidate.feedback };
}

/** Mean of each criterion across every scored answer, rounded to whole points. */
export function averageScores(scores: Score[]): Record<Criterion, number> {
  const averages = {} as Record<Criterion, number>;
  for (const criterion of CRITERIA) {
    const total = scores.reduce((sum, score) => sum + score[criterion], 0);
    averages[criterion] = scores.length ? Math.round(total / scores.length) : 0;
  }
  return averages;
}
