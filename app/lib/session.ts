"use client";

import { useSyncExternalStore } from "react";
import { ROLES, type ScoreSlot, type Session } from "./types.ts";

const SESSION_KEY = "mock-interview-session";

/**
 * sessionStorage is an external store, so it is read through
 * useSyncExternalStore rather than copied into component state. Writers call
 * notify() so every mounted page re-reads after a save.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

/** Returns the raw string so the snapshot is referentially stable between renders. */
function getSnapshot(): string | null {
  return sessionStorage.getItem(SESSION_KEY);
}

function getServerSnapshot(): string | null {
  return null;
}

export function loadSession(): Session | null {
  return parse(sessionStorage.getItem(SESSION_KEY));
}

export function useSession(): Session | null {
  return parse(useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot));
}

export function saveSession(session: Session): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  notify();
}

/**
 * Writes one score slot, re-reading storage first. Scoring runs in the
 * background while the candidate answers later questions, so several writes can
 * be in flight at once — each must merge into current storage rather than
 * overwrite it with the snapshot it captured when it started.
 */
export function saveScoreAt(index: number, slot: ScoreSlot): void {
  const current = loadSession();
  if (!current) return;
  const scores = [...current.scores];
  scores[index] = slot;
  saveSession({ ...current, scores });
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
  notify();
}

/**
 * sessionStorage is user-editable, so the stored value is validated rather
 * than cast. Anything unrecognised reads as "no session" and the pages
 * redirect, instead of throwing on a missing array further down. Pure: it must
 * not touch storage, because it runs during render.
 */
export function parse(raw: string | null): Session | null {
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  const candidate = value as Partial<Session>;
  const wellFormed =
    typeof candidate === "object" &&
    candidate !== null &&
    ROLES.includes(candidate.role as Session["role"]) &&
    Array.isArray(candidate.questions) &&
    Array.isArray(candidate.answers) &&
    Array.isArray(candidate.scores);

  return wellFormed ? (candidate as Session) : null;
}
