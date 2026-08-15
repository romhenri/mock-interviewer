"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { scoreAnswer } from "@/lib/scoring";
import { loadSession, saveSession, useSession } from "@/lib/session";

export default function Interview() {
  const router = useRouter();
  const session = useSession();
  const [answer, setAnswer] = useState("");

  useEffect(() => {
    const stored = loadSession();
    if (!stored) router.replace("/");
    // Reloading after the final answer would land on a question that does not exist.
    else if (stored.answers.length >= stored.questions.length) router.replace("/summary");
  }, [router]);

  if (!session) return null;

  const index = session.answers.length;
  const question = session.questions[index];
  if (question === undefined) return null;
  const reference = session.references[index] ?? null;
  const isLast = index === session.questions.length - 1;

  /** Records the answer and moves on. The judge call runs in the background. */
  function submit() {
    const current = loadSession();
    if (!current || !answer.trim() || question === undefined) return;

    saveSession({
      ...current,
      answers: [...current.answers, answer],
      scores: [...current.scores, null],
    });
    // Deliberately not awaited — the candidate should not wait on the judge.
    // The result is written back into the session by index when it arrives.
    void scoreAnswer(index, question, answer, reference);

    setAnswer("");
    if (isLast) router.push("/summary");
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
    if (isLast) router.push("/summary");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      {/* No way out but through: the exit lives on the summary, once there are
          results to leave behind. Skip is how you get past a question. */}
      <header className="text-sm opacity-60">
        {session.role} · question {index + 1} of {session.questions.length}
      </header>

      <h1 className="text-xl font-medium">{question}</h1>

      <textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        rows={4}
        placeholder={`Answer as you would out loud, name the mechanism, don't pad it.`}
        className="w-full resize-y rounded-lg border border-current/20 bg-transparent p-3 font-sans text-sm"
      />

      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={!answer.trim()}
          className="rounded-lg border border-current/30 px-5 py-2 text-sm font-medium transition hover:border-current/60 disabled:opacity-40"
        >
          {isLast ? "Finish and see results" : "Submit and continue"}
        </button>
        <button
          onClick={skip}
          className="rounded-lg px-3 py-2 text-sm opacity-60 transition hover:opacity-100"
        >
          Skip question
        </button>
      </div>

      <p className="text-xs opacity-50">
        Scoring runs in the background. All results are shown at the end.
      </p>
    </main>
  );
}
