"use client";

import { useSyncExternalStore } from "react";
import { attachSuggestedAnswer } from "./bookmarks.ts";
import { saveScoreAt } from "./session.ts";
import { openRouterHeaders } from "./settings.ts";

/**
 * Indices with a judge call in flight. Ephemeral on purpose: it is not stored,
 * so a reload leaves the slot unscored and the summary offers to score it
 * again, rather than showing a spinner for a request nobody is waiting on.
 */
const inFlight = new Set<number>();
const listeners = new Set<() => void>();

/** Serialised so the snapshot is a stable primitive across unchanged renders. */
function snapshot(): string {
  return [...inFlight].sort().join(",");
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePendingScores(): Set<number> {
  const serialised = useSyncExternalStore(subscribe, snapshot, () => "");
  return new Set(serialised ? serialised.split(",").map(Number) : []);
}

/**
 * Scores one answer in the background. The candidate has already moved on, so
 * failures are written into the slot instead of thrown — the summary reports
 * them and offers a retry, which keeps the "never spend a request without the
 * human asking" rule while letting the run continue unattended.
 */
export async function scoreAnswer(
  index: number,
  question: string,
  answer: string,
  reference: string | null,
): Promise<void> {
  if (inFlight.has(index)) return;
  inFlight.add(index);
  notify();

  try {
    const response = await fetch("/api/score-answer", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...openRouterHeaders() },
      body: JSON.stringify({ question, answer, reference }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "The judge could not score this answer.");
    saveScoreAt(index, body.score);
    // No-op unless this question is bookmarked, which it usually is not.
    attachSuggestedAnswer(question, body.score.suggestedAnswer);
  } catch (error) {
    saveScoreAt(index, { error: (error as Error).message });
  } finally {
    inFlight.delete(index);
    notify();
  }
}

function notify() {
  for (const listener of listeners) listener();
}
