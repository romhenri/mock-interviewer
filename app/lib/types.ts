export const ROLES = ["AI Engineer", "Software Engineer"] as const;

export type Role = (typeof ROLES)[number];

export type Score = {
  correctness: number;
  clarity: number;
  depth: number;
  feedback: string;
};

/**
 * Answers and scores are appended in lockstep: index i belongs to questions[i].
 * A skipped question appends null to both, so the indices stay aligned without
 * a separate list of which questions were skipped.
 */
export type Session = {
  role: Role;
  questions: string[];
  answers: (string | null)[];
  scores: (Score | null)[];
};
