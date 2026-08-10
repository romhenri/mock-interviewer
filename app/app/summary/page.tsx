"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { averageScores, CRITERIA } from "@/lib/score";
import { clearSession, loadSession, useSession } from "@/lib/session";

export default function Summary() {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    const stored = loadSession();
    if (!stored || stored.scores.length === 0) router.replace("/");
  }, [router]);

  if (!session || session.scores.length === 0) return null;

  const averages = averageScores(session.scores);

  function startOver() {
    clearSession();
    router.push("/");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Interview summary</h1>
        <p className="mt-1 text-sm opacity-60">
          {session.role} · {session.scores.length} questions answered
        </p>
      </div>

      <section className="rounded-lg border border-current/20 p-4">
        <h2 className="mb-3 text-xs uppercase tracking-wide opacity-60">Average per criterion</h2>
        <dl className="grid grid-cols-3 gap-3 text-center">
          {CRITERIA.map((criterion) => (
            <div key={criterion}>
              <dt className="text-xs uppercase tracking-wide opacity-60">{criterion}</dt>
              <dd className="text-3xl font-semibold tabular-nums">{averages[criterion]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-wide opacity-60">Per question</h2>
        {session.scores.map((score, index) => (
          <article key={index} className="rounded-lg border border-current/20 p-4">
            <h3 className="text-sm font-medium">
              {index + 1}. {session.questions[index]}
            </h3>
            <dl className="mt-3 flex gap-6 text-sm">
              {CRITERIA.map((criterion) => (
                <div key={criterion} className="flex gap-2">
                  <dt className="capitalize opacity-60">{criterion}</dt>
                  <dd className="font-semibold tabular-nums">{score[criterion]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm opacity-80">{score.feedback}</p>
          </article>
        ))}
      </section>

      <button
        onClick={startOver}
        className="self-start rounded-lg border border-current/30 px-5 py-2 text-sm font-medium transition hover:border-current/60"
      >
        Start over
      </button>
    </main>
  );
}
