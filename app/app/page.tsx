"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { loadBookmarks, pickQuestions, REUSE_CHANCE } from "@/lib/bookmarks";
import { QUESTION_COUNT } from "@/lib/prompts";
import { saveSession } from "@/lib/session";
import { DEFAULT_LEVEL, LEVELS, ROLE_SUMMARY, ROLES, SUBJECTS, type Role } from "@/lib/types";

export default function RoleSelection() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [levelIndex, setLevelIndex] = useState(LEVELS.indexOf(DEFAULT_LEVEL));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(picked: Role) {
    setRole(picked);
    setSubjects([]);
    setError(null);
    dialog.current?.showModal();
  }

  function toggle(subject: string) {
    setSubjects((current) =>
      current.includes(subject)
        ? current.filter((s) => s !== subject)
        : [...current, subject],
    );
  }

  async function start() {
    if (!role) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, level: LEVELS[levelIndex], subjects }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not generate questions.");

      // Saved questions have a REUSE_CHANCE each of displacing a generated one.
      const questions = pickQuestions(
        body.questions,
        loadBookmarks().filter((bookmark) => bookmark.role === role),
        REUSE_CHANCE,
      );
      saveSession({ role, questions, answers: [], scores: [] });
      router.push("/interview");
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Agent Interviewer</h1>
        <p className="mt-2 text-sm opacity-70">
          Pick a role. You get {QUESTION_COUNT} questions, and each answer is scored on correctness,
          clarity and depth.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {ROLES.map((option) => (
          <button
            key={option}
            onClick={() => choose(option)}
            className="rounded-lg border border-current/20 p-6 text-left transition hover:border-current/50"
          >
            <span className="block text-lg font-medium">{option}</span>
            <span className="mt-1 block text-sm opacity-60">{ROLE_SUMMARY[option]}</span>
          </button>
        ))}
      </div>

      <dialog
        ref={dialog}
        onClose={() => setRole(null)}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-current/20 bg-background p-6 text-foreground backdrop:bg-black/50"
      >
        {role && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-lg font-medium">{role} subjects</h2>
              <p className="mt-1 text-sm opacity-60">
                Pick what the questions should cover. Select nothing for a mix of everything.
              </p>
            </div>

            <label className="flex flex-col gap-2">
              <span className="flex items-baseline justify-between text-sm">
                <span className="opacity-60">Seniority</span>
                <span className="font-medium">{LEVELS[levelIndex]}</span>
              </span>
              <input
                type="range"
                min={0}
                max={LEVELS.length - 1}
                step={1}
                value={levelIndex}
                onChange={(event) => setLevelIndex(Number(event.target.value))}
                aria-valuetext={LEVELS[levelIndex]}
                list="levels"
                className="w-full accent-current"
              />
              {/* Renders native tick marks under the track. */}
              <datalist id="levels">
                {LEVELS.map((name, i) => (
                  <option key={name} value={i} label={name} />
                ))}
              </datalist>
              <span className="flex justify-between text-xs opacity-50">
                <span>{LEVELS[0]}</span>
                <span>{LEVELS[LEVELS.length - 1]}</span>
              </span>
            </label>

            <div className="flex flex-wrap gap-2">
              {SUBJECTS[role].map((subject) => {
                const on = subjects.includes(subject);
                return (
                  <button
                    key={subject}
                    onClick={() => toggle(subject)}
                    aria-pressed={on}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      on
                        ? "border-current bg-current/10 font-medium"
                        : "border-current/20 opacity-70 hover:opacity-100"
                    }`}
                  >
                    {subject}
                  </button>
                );
              })}
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              <span className="mr-auto text-sm opacity-50">
                {subjects.length || "all"} selected
              </span>
              <button
                onClick={() => dialog.current?.close()}
                disabled={loading}
                className="rounded-lg px-3 py-2 text-sm opacity-60 transition hover:opacity-100 disabled:opacity-30"
              >
                Cancel
              </button>
              <button
                onClick={start}
                disabled={loading}
                className="rounded-lg border border-current/30 px-5 py-2 text-sm font-medium transition hover:border-current/60 disabled:opacity-40"
              >
                {loading ? "Generating questions…" : "Start interview"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </main>
  );
}
