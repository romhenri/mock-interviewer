"use client";

import { useState } from "react";
import { useBookmarks } from "@/lib/bookmarks";
import { ROLES, type Role } from "@/lib/types";

export default function Cache() {
  const bookmarks = useBookmarks();
  const [role, setRole] = useState<Role>(ROLES[0]);
  const shown = bookmarks.filter((bookmark) => bookmark.role === role);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Cached questions</h1>
        <p className="mt-1 text-sm opacity-60">
          Bookmarked questions from localStorage, by role. Each has a chance of reappearing in a
          new interview for that role.
        </p>
      </div>

      <div role="tablist" className="flex flex-wrap gap-2">
        {ROLES.map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={role === option}
            onClick={() => setRole(option)}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              role === option
                ? "border-current bg-current/10 font-medium"
                : "border-current/20 opacity-70 hover:opacity-100"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <section role="tabpanel" className="flex flex-col gap-4">
        {shown.length === 0 ? (
          <p className="text-sm opacity-50">No saved questions for this role yet.</p>
        ) : (
          shown.map((bookmark) => (
            <article key={bookmark.question} className="rounded-lg border border-current/20 p-4">
              <p className="text-xs uppercase tracking-wide opacity-60">{bookmark.topic}</p>
              <h3 className="mt-1 text-sm font-medium">{bookmark.question}</h3>
              {bookmark.suggestedAnswer ? (
                <div className="mt-3">
                  <p className="text-xs uppercase tracking-wide opacity-60">Suggestion</p>
                  <p className="mt-1 text-sm opacity-80">{bookmark.suggestedAnswer}</p>
                </div>
              ) : (
                <p className="mt-3 text-sm opacity-50">
                  No suggestion yet — bookmarked before scoring finished.
                </p>
              )}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
