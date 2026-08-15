"use client";

import { toggleCached, useCache } from "@/lib/cache";
import type { Role } from "@/lib/types";

type Props = {
  question: string;
  role: Role;
  /** Kept so a discarded question can be put back with its answer intact. */
  suggestedAnswer?: string;
};

/**
 * Discards a question from the cache, or puts it back. Only on the summary:
 * during the interview the answer is not on screen yet, so there is nothing to
 * judge the question by.
 */
export default function CacheButton({ question, role, suggestedAnswer }: Props) {
  const cached = useCache();
  const saved = cached.some((entry) => entry.question === question);

  return (
    <button
      onClick={() => toggleCached(question, role, suggestedAnswer)}
      aria-pressed={saved}
      aria-label={saved ? "Remove from cache" : "Put back in the cache"}
      title={saved ? "Cached, may reappear in a later interview" : "Removed from the cache"}
      className={`shrink-0 rounded-lg p-2 transition ${
        saved ? "opacity-100" : "opacity-40 hover:opacity-80"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill={saved ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
      </svg>
    </button>
  );
}
