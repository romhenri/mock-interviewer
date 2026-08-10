"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QUESTION_COUNT } from "@/lib/prompts";
import { saveSession } from "@/lib/session";
import { ROLES, type Role } from "@/lib/types";

export default function RoleSelection() {
  const router = useRouter();
  const [loading, setLoading] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(role: Role) {
    setLoading(role);
    setError(null);
    try {
      const response = await fetch("/api/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not generate questions.");

      saveSession({ role, questions: body.questions, answers: [], scores: [] });
      router.push("/interview");
    } catch (err) {
      setError((err as Error).message);
      setLoading(null);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 p-6">
      <div>
        <h1 className="text-3xl font-semibold">Mock Interviewer</h1>
        <p className="mt-2 text-sm opacity-70">
          Pick a role. You get {QUESTION_COUNT} questions, and each answer is scored on correctness,
          clarity and depth.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {ROLES.map((role) => (
          <button
            key={role}
            onClick={() => start(role)}
            disabled={loading !== null}
            className="rounded-lg border border-current/20 p-6 text-left transition hover:border-current/50 disabled:opacity-50"
          >
            <span className="block text-lg font-medium">{role}</span>
            <span className="mt-1 block text-sm opacity-60">
              {loading === role ? "Generating questions…" : "Start interview"}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">
          {error}
        </p>
      )}
    </main>
  );
}
