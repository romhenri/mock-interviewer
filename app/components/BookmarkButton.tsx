"use client";

import { toggleBookmark, useBookmarks } from "@/lib/bookmarks";
import type { Role } from "@/lib/types";

type Props = {
  question: string;
  role: Role;
  /** Known on the summary, absent during the interview — saved when present. */
  suggestedAnswer?: string;
};

export default function BookmarkButton({ question, role, suggestedAnswer }: Props) {
  const bookmarks = useBookmarks();
  const saved = bookmarks.some((bookmark) => bookmark.question === question);

  return (
    <button
      onClick={() => toggleBookmark(question, role, suggestedAnswer)}
      aria-pressed={saved}
      aria-label={saved ? "Remove bookmark" : "Bookmark this question"}
      title={saved ? "Saved — may reappear in a later interview" : "Save this question"}
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
