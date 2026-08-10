"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CRITERIA } from "@/lib/score";
import { loadSession, saveSession, useSession } from "@/lib/session";
import type { Score } from "@/lib/types";

export default function Interview() {
  const router = useRouter();
  const session = useSession();
  const [answer, setAnswer] = useState("");
  const [score, setScore] = useState<Score | null>(null);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadSession();
    if (!stored) router.replace("/");
    // Reloading after the final answer would land on a question that does not exist.
    else if (stored.answers.length >= stored.questions.length) router.replace("/summary");
  }, [router]);

  if (!session) return null;

  // Submitting appends to answers, so once a score is showing the question on
  // screen is the one just answered, not the next one.
  const index = score ? session.answers.length - 1 : session.answers.length;
  const question = session.questions[index];
  if (question === undefined) return null;
  const isLast = index === session.questions.length - 1;

  async function submit() {
    const current = loadSession();
    if (!current || !answer.trim()) return;
    setScoring(true);
    setError(null);
    try {
      const response = await fetch("/api/score-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The judge could not score this answer.");

      saveSession({
        ...current,
        answers: [...current.answers, answer],
        scores: [...current.scores, body.score],
      });
      setScore(body.score);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScoring(false);
    }
  }

  function next() {
    if (isLast) {
      router.push("/summary");
      return;
    }
    setAnswer("");
    setScore(null);
  }

  /** Records the skip and moves on without calling the judge — costs no request. */
  function skip() {
    const current = loadSession();
    if (!current) return;
    saveSession({
      ...current,
      answers: [...current.answers, null],
      scores: [...current.scores, null],
    });
    setAnswer("");
    setError(null);
    if (isLast) router.push("/summary");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <header className="text-sm opacity-60">
        {session.role} · question {index + 1} of {session.questions.length}
      </header>

      <h1 className="text-xl font-medium">{question}</h1>

      <textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        disabled={score !== null || scoring}
        rows={10}
        placeholder="Type your answer…"
        className="w-full resize-y rounded-lg border border-current/20 bg-transparent p-3 font-sans text-sm disabled:opacity-60"
      />

      {score === null ? (
        <div className="flex items-center gap-3">
          <button
            onClick={submit}
            disabled={!answer.trim() || scoring}
            className="rounded-lg border border-current/30 px-5 py-2 text-sm font-medium transition hover:border-current/60 disabled:opacity-40"
          >
            {scoring ? "Scoring…" : "Submit answer"}
          </button>
          <button
            onClick={skip}
            disabled={scoring}
            className="rounded-lg px-3 py-2 text-sm opacity-60 transition hover:opacity-100 disabled:opacity-30"
          >
            Skip question
          </button>
        </div>
      ) : (
        <section className="flex flex-col gap-4 rounded-lg border border-current/20 p-4">
          <dl className="grid grid-cols-3 gap-3 text-center">
            {CRITERIA.map((criterion) => (
              <div key={criterion}>
                <dt className="text-xs uppercase tracking-wide opacity-60">{criterion}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{score[criterion]}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm opacity-80">{score.feedback}</p>
          <button
            onClick={next}
            className="self-start rounded-lg border border-current/30 px-5 py-2 text-sm font-medium transition hover:border-current/60"
          >
            {isLast ? "See summary" : "Next question"}
          </button>
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">
          {error} — nothing was scored. Submit again to spend another request.
        </p>
      )}
    </main>
  );
}
