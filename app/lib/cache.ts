"use client";

import { useSyncExternalStore } from "react";
import { ROLES, type GeneratedQuestion, type Role } from "./types.ts";

/** Still the bookmark key: renaming it would orphan every cache already stored. */
const CACHE_KEY = "mock-interview-bookmarks";

export type CachedQuestion = {
  question: string;
  role: Role;
  /** The "Topic:" label the generator prefixes each question with. */
  topic: string;
  /** The full-credit answer the question was generated with. Absent only on
   * entries cached before the generator wrote one. */
  suggestedAnswer?: string;
};

/** Questions come back as "Caching: what is a stampede?" — the label is the subject. */
export function topicOf(question: string): string {
  const colon = question.indexOf(":");
  // A colon deep into the text is punctuation, not a label.
  if (colon <= 0 || colon > 40) return "General";
  return question.slice(0, colon).trim();
}

/**
 * Draws up to `count` cached questions at random, no repeats. Backs the
 * "only cache" source, which spends no request at all — returning fewer than
 * asked is the honest outcome when the cache is thin, and the interview just
 * runs short. `random` is injectable so the draw can be tested without
 * depending on Math.random.
 */
export function pickCached(
  cached: CachedQuestion[],
  count: number,
  random: () => number = Math.random,
): GeneratedQuestion[] {
  const pool = [...cached];
  const picked: GeneratedQuestion[] = [];

  while (pool.length > 0 && picked.length < count) {
    const [saved] = pool.splice(Math.floor(random() * pool.length), 1);
    picked.push({ question: saved!.question, answer: saved!.suggestedAnswer });
  }

  return picked;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string {
  return localStorage.getItem(CACHE_KEY) ?? "[]";
}

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Reads a stored list, dropping anything unrecognised — localStorage is
 * user-editable, and the ground-truth file is hand-written.
 */
export function parseCached(raw: string): CachedQuestion[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  return value.filter((entry): entry is CachedQuestion => {
    const candidate = entry as Partial<CachedQuestion>;
    return (
      typeof candidate?.question === "string" &&
      candidate.question.trim() !== "" &&
      ROLES.includes(candidate.role as Role) &&
      typeof candidate.topic === "string" &&
      (candidate.suggestedAnswer === undefined || typeof candidate.suggestedAnswer === "string")
    );
  });
}

export function loadCache(): CachedQuestion[] {
  return parseCached(getSnapshot());
}

export function useCache(): CachedQuestion[] {
  return parseCached(useSyncExternalStore(subscribe, getSnapshot, () => "[]"));
}

function write(cached: CachedQuestion[]): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  notify();
}

/**
 * Caches every question in a freshly generated set. Generation is the expensive
 * step and the answer is written with the question, so keeping the result costs
 * nothing and makes the "only cache" source usable without anyone curating it.
 * Questions already cached are left as they are — an entry is only ever removed
 * by hand, from the summary.
 */
export function cacheQuestions(questions: GeneratedQuestion[], role: Role): void {
  const current = loadCache();
  const merged = mergeCache(current, questions, role);
  if (merged.length > current.length) write(merged);
}

/** The merge on its own, so the de-duplication is testable without storage. */
export function mergeCache(
  current: CachedQuestion[],
  questions: GeneratedQuestion[],
  role: Role,
): CachedQuestion[] {
  const fresh = questions.filter(
    (item) => !current.some((entry) => entry.question === item.question),
  );

  return [
    ...current,
    ...fresh.map((item) => ({
      question: item.question,
      role,
      topic: topicOf(item.question),
      suggestedAnswer: item.answer,
    })),
  ];
}

/**
 * Removes the question from the cache, or puts it back. Returns whether it is
 * cached afterwards. Everything is cached by default, so this is a discard —
 * it stays a toggle so a mis-click is undoable without regenerating.
 */
export function toggleCached(question: string, role: Role, suggestedAnswer?: string): boolean {
  const current = loadCache();

  if (current.some((entry) => entry.question === question)) {
    write(current.filter((entry) => entry.question !== question));
    return false;
  }
  write([...current, { question, role, topic: topicOf(question), suggestedAnswer }]);
  return true;
}

/**
 * The fixed question set behind the "ground truth" source. Served from
 * `public/data/` rather than imported, so editing the file needs no rebuild and
 * it never ships inside the JS bundle. Entries that fail validation are dropped
 * — a typo in one hand-written question must not take the whole file down.
 */
export async function loadGroundTruth(): Promise<CachedQuestion[]> {
  const response = await fetch("/data/ground-truth.json");
  if (!response.ok) {
    throw new Error(`Could not read the ground-truth file (HTTP ${response.status}).`);
  }
  return parseCached(await response.text());
}
