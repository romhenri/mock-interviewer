"use client";

import Link from "next/link";
import { useState } from "react";
import { useCache } from "@/lib/cache";
import { ROLES, type Role } from "@/lib/types";

export default function Cache() {
  const cached = useCache();
  const [role, setRole] = useState<Role>(ROLES[0]);
  const shown = cached.filter((entry) => entry.role === role);

  /** Every role, not just the one on screen: this is a backup of the whole cache. */
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(cached, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "mock-interview-cache.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-3 text-sm">
        <Link href="/" className="opacity-60 transition hover:opacity-100">
          ← Back home
        </Link>
        <button
          onClick={download}
          disabled={cached.length === 0}
          className="shrink-0 rounded-lg border border-current/30 px-3 py-1.5 transition hover:border-current/60 disabled:opacity-30"
        >
          Download all ({cached.length})
        </button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Cached questions</h1>
        <p className="mt-1 text-sm opacity-60">
          Every generated question is kept here, by role, and the “only cache” source draws from
          it. Discard the ones you do not want from the interview summary.
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
          <p className="text-sm opacity-50">Nothing cached for this role yet.</p>
        ) : (
          shown.map((entry) => (
            <article key={entry.question} className="rounded-lg border border-current/20 p-4">
              <p className="text-xs uppercase tracking-wide opacity-60">{entry.topic}</p>
              <h3 className="mt-1 text-sm font-medium">{entry.question}</h3>
              {entry.suggestedAnswer ? (
                <div className="mt-3">
                  <p className="text-xs uppercase tracking-wide opacity-60">Suggestion</p>
                  <p className="mt-1 text-sm opacity-80">{entry.suggestedAnswer}</p>
                </div>
              ) : (
                <p className="mt-3 text-sm opacity-50">
                  No suggestion. Cached before questions carried their own answer.
                </p>
              )}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
