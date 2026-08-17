export const ROLES = [
  "AI Engineer",
  "Software Engineer",
  "Front-end Engineer",
  "Back-end Engineer",
  "Data Struct. & Algorithms",
  "Formal Languages",
  "DevOps",
  "Infra",
] as const;

export type Role = (typeof ROLES)[number];

/** One line on what the role actually does, shown under its name on the cards. */
export const ROLE_SUMMARY: Record<Role, string> = {
  "AI Engineer": "Builds products on top of models.",
  "Software Engineer": "Builds and runs the systems behind a product.",
  "Front-end Engineer": "Builds the interface people actually touch.",
  "Back-end Engineer": "Builds the services and data behind the interface.",
  "Data Struct. & Algorithms": "Solves problems with the right structure and the right complexity.",
  "Formal Languages": "Reasons about grammars, automata, and what machines can decide.",
  "DevOps": "Builds the pipelines and automation that ship the product.",
  "Infra": "Builds and runs the platform everything else sits on.",
};

/** Ordered from least to most senior — the slider maps its value to an index here. */
export const LEVELS = ["Rookie", "Entry", "Mid", "Senior"] as const;

export type Level = (typeof LEVELS)[number];

export const DEFAULT_LEVEL: Level = "Mid";

/**
 * What the slider shows, where it differs from what the prompt says. "Intern" is
 * the word candidates recognise; "Rookie" is the word that makes a model pitch
 * the questions low enough, so each side keeps the one that works.
 */
const LEVEL_LABEL: Partial<Record<Level, string>> = { Rookie: "Intern" };

export function levelLabel(level: Level): string {
  return LEVEL_LABEL[level] ?? level;
}

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
  "Front-end Engineer": [
    "HTML Semantics",
    "CSS Layout",
    "JavaScript",
    "TypeScript",
    "React",
    "State Management",
    "Rendering and Hydration",
    "Accessibility",
    "Browser Performance",
    "Bundling",
    "Forms and Validation",
    "Caching and CDNs",
    "Testing",
    "Web Security",
    "Responsive Design",
  ],
  "Back-end Engineer": [
    "API Design",
    "HTTP",
    "Databases",
    "SQL and Indexing",
    "Transactions",
    "Caching",
    "Queues and Messaging",
    "Concurrency",
    "Authentication",
    "Authorization",
    "Scaling",
    "Observability",
    "Testing",
    "Deployment",
    "Error Handling",
  ],
  "Data Struct. & Algorithms": [
    "Arrays and Strings",
    "Linked Lists",
    "Stacks and Queues",
    "Hash Tables",
    "Trees",
    "Heaps",
    "Graphs",
    "Sorting",
    "Searching",
    "Recursion",
    "Dynamic Programming",
    "Greedy Algorithms",
    "Backtracking",
    "Complexity Analysis",
    "Bit Manipulation",
  ],
  "Formal Languages": [
    "Alphabets and Strings",
    "Regular Languages",
    "Regular Expressions",
    "Finite Automata",
    "Pumping Lemma",
    "Context-free Grammars",
    "Pushdown Automata",
    "Parsing",
    "Chomsky Hierarchy",
    "Turing Machines",
    "Decidability",
    "Halting Problem",
    "Reductions",
    "Closure Properties",
    "Ambiguity",
  ],
  "DevOps": [
    "CI/CD",
    "Containers",
    "Kubernetes",
    "Infrastructure as Code",
    "Configuration Management",
    "Monitoring and Alerting",
    "Logging",
    "Release Management",
    "Automation",
    "Cloud Platforms",
    "Networking",
    "Secrets Management",
    "Incident Response",
    "Scaling",
    "Version Control",
  ],
  "Infra": [
    "Networking",
    "Cloud Platforms",
    "Kubernetes",
    "Infrastructure as Code",
    "Load Balancing",
    "DNS",
    "Storage Systems",
    "Compute Provisioning",
    "Observability",
    "Disaster Recovery",
    "Security and Access Control",
    "Capacity Planning",
    "Service Mesh",
    "Cost Optimization",
    "Automation",
  ],
};

/**
 * A question and the full-credit answer written in the same generation call.
 * `answer` is absent only on questions cached before generation wrote one.
 */
export type GeneratedQuestion = { question: string; answer?: string };

/** One line of feedback per criterion, so each number says why it is what it is. */
export type Feedback = { correctness: string; english: string; depth: string };

export type Score = {
  correctness: number;
  english: number;
  depth: number;
  feedback: Feedback;
  suggestedAnswer: string;
  /** Which model actually judged — the chain falls back, so it varies. */
  model?: string;
};

/** A scoring attempt that failed. Kept so the summary can say what went wrong. */
export type ScoreError = { error: string };

/** null means either skipped (answers[i] is null) or not scored yet. */
export type ScoreSlot = Score | ScoreError | null;

/**
 * Answers and scores are appended in lockstep: index i belongs to questions[i].
 * A skipped question appends null to both, so the indices stay aligned without
 * a separate list of which questions were skipped.
 *
 * `references` is filled at generation time and never grows: it is the full-credit
 * answer the judge scores questions[i] against. null where there is none — a reused
 * cached question from before answers came with the question.
 */
export type Session = {
  role: Role;
  questions: string[];
  references: (string | null)[];
  answers: (string | null)[];
  scores: ScoreSlot[];
};
