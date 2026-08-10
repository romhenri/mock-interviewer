"use client";

import { useSyncExternalStore } from "react";
import { ROLES, type Role } from "./types.ts";

const BOOKMARKS_KEY = "mock-interview-bookmarks";

/**
 * Chance that any one question in a new interview is replaced by a saved one.
 * Set NEXT_PUBLIC_REUSE_CHANCE to a value between 0 and 1 — 0 disables reuse.
 */
export const REUSE_CHANCE = clampChance(Number(process.env.NEXT_PUBLIC_REUSE_CHANCE ?? 0.2));

function clampChance(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

export type Bookmark = {
  question: string;
  role: Role;
  /** The "Topic:" label the generator prefixes each question with. */
  topic: string;
  /** Filled in when the judge returns, so it is absent on a fresh bookmark. */
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
 * Substitutes saved questions into a freshly generated set, each with `chance`
 * probability. `random` is injectable so the behaviour can be tested without
 * depending on Math.random.
 */
export function pickQuestions(
  generated: string[],
  bookmarks: Bookmark[],
  chance: number,
  random: () => number = Math.random,
): string[] {
  const available = bookmarks.filter((bookmark) => !generated.includes(bookmark.question));
  const result: string[] = [];

  for (const question of generated) {
    const candidates = available.filter((bookmark) => !result.includes(bookmark.question));
    if (candidates.length > 0 && random() < chance) {
      // A second draw picks which saved question, so no bookmark is favoured.
      result.push(candidates[Math.floor(random() * candidates.length)]!.question);
    } else {
      result.push(question);
    }
  }

  return result;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string {
  return localStorage.getItem(BOOKMARKS_KEY) ?? "[]";
}

function notify() {
  for (const listener of listeners) listener();
}

/** localStorage is user-editable, so anything unrecognised is dropped. */
function parse(raw: string): Bookmark[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  return value.filter((entry): entry is Bookmark => {
    const candidate = entry as Partial<Bookmark>;
    return (
      typeof candidate?.question === "string" &&
      candidate.question.trim() !== "" &&
      ROLES.includes(candidate.role as Role) &&
      typeof candidate.topic === "string" &&
      (candidate.suggestedAnswer === undefined || typeof candidate.suggestedAnswer === "string")
    );
  });
}

export function loadBookmarks(): Bookmark[] {
  return parse(getSnapshot());
}

export function useBookmarks(): Bookmark[] {
  return parse(useSyncExternalStore(subscribe, getSnapshot, () => "[]"));
}

function write(bookmarks: Bookmark[]): void {
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  notify();
}

/**
 * Adds the question if absent, removes it if present. Returns the new state.
 * `suggestedAnswer` is known on the summary but not during the interview, where
 * scoring has not finished — see attachSuggestedAnswer for that case.
 */
export function toggleBookmark(question: string, role: Role, suggestedAnswer?: string): boolean {
  const current = loadBookmarks();
  const existing = current.find((bookmark) => bookmark.question === question);

  if (existing) {
    write(current.filter((bookmark) => bookmark.question !== question));
    return false;
  }
  write([...current, { question, role, topic: topicOf(question), suggestedAnswer }]);
  return true;
}

/**
 * Attaches the judge's model answer to a saved question. Called when scoring
 * finishes, since a question can be bookmarked before it has been scored.
 */
export function attachSuggestedAnswer(question: string, suggestedAnswer: string): void {
  const current = loadBookmarks();
  if (!current.some((bookmark) => bookmark.question === question)) return;

  write(
    current.map((bookmark) =>
      bookmark.question === question ? { ...bookmark, suggestedAnswer } : bookmark,
    ),
  );
}
