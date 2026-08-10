export const ROLES = ["AI Engineer", "Software Engineer"] as const;

export type Role = (typeof ROLES)[number];

/** Subjects the candidate can narrow an interview to. Selecting none means "anything". */
export const SUBJECTS: Record<Role, readonly string[]> = {
  "AI Engineer": [
    "RNNs",
    "CNNs",
    "Transformers",
    "Attention",
    "Tokenization",
    "Embeddings",
    "Vector Search",
    "RAG",
    "Fine-tuning",
    "Prompt Engineering",
    "Evaluation",
    "Diffusion Models",
    "Reinforcement Learning",
    "Inference Optimization",
    "Training Infrastructure",
  ],
  "Software Engineer": [
    "Data Structures",
    "Algorithms",
    "Concurrency",
    "Databases",
    "Caching",
    "System Design",
    "APIs and HTTP",
    "Distributed Systems",
    "Testing",
    "Security",
    "Observability",
    "CI/CD",
    "Memory Management",
    "Networking",
    "Version Control",
  ],
};

export type Score = {
  correctness: number;
  clarity: number;
  depth: number;
  feedback: string;
  suggestedAnswer: string;
};

/** A scoring attempt that failed. Kept so the summary can say what went wrong. */
export type ScoreError = { error: string };

/** null means either skipped (answers[i] is null) or not scored yet. */
export type ScoreSlot = Score | ScoreError | null;

/**
 * Answers and scores are appended in lockstep: index i belongs to questions[i].
 * A skipped question appends null to both, so the indices stay aligned without
 * a separate list of which questions were skipped.
 */
export type Session = {
  role: Role;
  questions: string[];
  answers: (string | null)[];
  scores: ScoreSlot[];
};
