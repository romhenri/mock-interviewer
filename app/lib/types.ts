export const ROLES = ["AI Engineer", "Software Engineer"] as const;

export type Role = (typeof ROLES)[number];

export type Score = {
  correctness: number;
  clarity: number;
  depth: number;
  feedback: string;
};

/** Answers and scores are appended in lockstep: index i belongs to questions[i]. */
export type Session = {
  role: Role;
  questions: string[];
  answers: string[];
  scores: Score[];
};
