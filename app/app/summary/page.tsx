"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import CacheButton from "@/components/CacheButton";
import { averageScores, CRITERIA, isScore } from "@/lib/score";
import { scoreAnswer, usePendingScores } from "@/lib/scoring";
import { clearSession, loadSession, useSession } from "@/lib/session";

/** Red below 40, amber up to 70, green above — same scale for numbers and borders. */
function tone(value: number) {
  if (value >= 70) return { text: "text-emerald-600 dark:text-emerald-400", border: "border-l-emerald-500" };
  if (value >= 40) return { text: "text-amber-600 dark:text-amber-400", border: "border-l-amber-500" };
  return { text: "text-red-600 dark:text-red-400", border: "border-l-red-500" };
}

export default function Summary() {
  const router = useRouter();
  const session = useSession();
  const pending = usePendingScores();

  useEffect(() => {
    const stored = loadSession();
    // An untouched session has nothing to summarise; a fully skipped one does.
    if (!stored || stored.answers.length === 0) router.replace("/");
  }, [router]);

  if (!session || session.answers.length === 0) return null;

  const scoredCount = session.scores.filter(isScore).length;
  const attempted = session.answers.filter((answer) => answer !== null).length;
  const averages = averageScores(session.scores);
  const stillScoring = pending.size > 0;
  // Fallback can swap the judge mid-interview, which makes scores from
  // different models no longer directly comparable.
  const judges = [...new Set(session.scores.filter(isScore).map((s) => s.model).filter(Boolean))];

  function startOver() {
    clearSession();
    router.push("/");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Interview summary</h1>
          <p className="mt-1 text-sm opacity-60">
            {session.role} · {attempted} of {session.answers.length} questions answered
            {attempted < session.answers.length &&
              ` · ${session.answers.length - attempted} skipped`}
            {stillScoring && ` · ${pending.size} still being scored`}
          </p>
        </div>
        {/* Leaves the session alone, so the results are still here on the way back.
            "Start over" at the foot of the page is the one that throws them away. */}
        <button
          onClick={() => router.push("/")}
          className="shrink-0 text-sm opacity-60 transition hover:opacity-100"
        >
          ← Back home
        </button>
      </div>

      <section className="rounded-lg border border-current/20 p-4">
        <h2 className="mb-3 text-xs uppercase tracking-wide opacity-60">
          Average per criterion
          {scoredCount > 0 && scoredCount < session.answers.length && " (scored answers only)"}
        </h2>
        {scoredCount === 0 ? (
          <p className="text-sm opacity-60">
            {stillScoring
              ? "Waiting for the first score…"
              : "Nothing was scored, so there is nothing to average."}
          </p>
        ) : (
          <dl className="grid grid-cols-3 gap-3 text-center">
            {CRITERIA.map((criterion) => (
              <div key={criterion}>
                <dt className="text-xs uppercase tracking-wide opacity-60">{criterion}</dt>
                <dd className={`text-3xl font-semibold tabular-nums ${tone(averages[criterion]).text}`}>
                  {averages[criterion]}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {judges.length > 1 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Answers were judged by different models ({judges.join(", ")}) because the primary was
          unavailable. Scores from different judges are not directly comparable.
        </p>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-wide opacity-60">Per question</h2>
        {session.questions.map((question, index) => {
          const answer = session.answers[index];
          const slot = session.scores[index];
          const reference = session.references[index] ?? null;

          // The card is accented by correctness — the criterion that says right or wrong.
          const accent = isScore(slot) ? `border-l-4 ${tone(slot.correctness).border}` : "";

          return (
            <article key={index} className={`rounded-lg border border-current/20 p-4 ${accent}`}>
              <div className="flex items-start gap-3">
                <h3 className="flex-1 text-sm font-medium">
                  {index + 1}. {question}
                </h3>
                <CacheButton
                  question={question}
                  role={session!.role}
                  suggestedAnswer={reference ?? (isScore(slot) ? slot.suggestedAnswer : undefined)}
                />
              </div>

              {/* The answer sits with the question it answers, above the judging. */}
              {answer !== null && answer !== undefined && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm opacity-60 hover:opacity-100">
                    Your answer
                  </summary>
                  <p className="mt-2 rounded-lg border border-current/15 p-3 text-sm opacity-80">
                    {answer}
                  </p>
                </details>
              )}

              {answer === undefined ? (
                <p className="mt-3 text-sm opacity-50">Not reached.</p>
              ) : answer === null ? (
                <>
                  <p className="mt-3 text-sm opacity-50">Skipped, not answered, not scored.</p>
                  {/* The answer was written with the question, so a skip still gets
                      to see it — no scoring request needed. */}
                  {reference && (
                    <div className="mt-3">
                      <h4 className="text-sm opacity-60">Suggested answer</h4>
                      <p className="mt-2 rounded-lg border border-current/15 p-3 text-sm opacity-80">
                        {reference}
                      </p>
                    </div>
                  )}
                </>
              ) : pending.has(index) ? (
                <p className="mt-3 text-sm opacity-60">Scoring…</p>
              ) : isScore(slot) ? (
                <>
                  {/* One block per criterion: its score and the line that explains it. */}
                  <dl className="mt-3 flex flex-col gap-2 text-sm">
                    {CRITERIA.map((criterion) => (
                      <div key={criterion}>
                        <dt className="flex items-baseline gap-2">
                          <span className="font-semibold capitalize">{criterion}</span>
                          <span
                            className={`font-semibold tabular-nums ${tone(slot[criterion]).text}`}
                          >
                            {slot[criterion]}
                          </span>
                        </dt>
                        <dd className="opacity-80">{slot.feedback[criterion]}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3">
                    <h4 className="text-sm opacity-60">Suggested answer</h4>
                    <p className="mt-2 rounded-lg border border-current/15 p-3 text-sm opacity-80">
                      {slot.suggestedAnswer}
                    </p>
                  </div>
                </>
              ) : (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <p
                    className={
                      slot === null ? "text-sm opacity-70" : "text-sm text-red-600 dark:text-red-400"
                    }
                  >
                    {slot === null ? "Not scored." : `Scoring failed: ${slot.error}`}
                  </p>
                  <button
                    onClick={() => scoreAnswer(index, question, answer, reference)}
                    className="rounded-lg border border-current/30 px-3 py-1.5 text-sm transition hover:border-current/60"
                  >
                    Score this answer
                  </button>
                </div>
              )}
            </article>
          );
        })}
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
