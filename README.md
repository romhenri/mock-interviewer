# Mock Interviewer

Pick a role, answer three generated interview questions in two or three sentences each, get each
answer scored 0–100 on correctness, English and depth by an LLM judge. Questions and scoring both run through
[OpenRouter](https://openrouter.ai); the API key stays server-side.

```
mock-interviewer/
├── app/                  Next.js app — the thing you run
├── experiments/          Kedro pipeline measuring question quality
└── TICKETS.md            the work, as a checklist
```

## Setup

You need an OpenRouter API key: https://openrouter.ai/keys

```bash
cd app
npm install
cp .env.local.example .env.local   # then paste your key into OPENROUTER_API_KEY
npm run dev
```

Open http://localhost:4242.

`.env.local` holds two variables:

| Variable | Required | Default |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | — |
| `OPENROUTER_MODEL` | no | `openai/gpt-oss-20b:free` |
| `NEXT_PUBLIC_REUSE_CHANCE` | no | `0.2` |

`OPENROUTER_MODEL` is only the *first* model tried. The free pool is shared and routinely queues or
rate-limits, so a single-model call fails often enough to be unusable — the client falls through up
to three models before giving up. Measured round-trip times (Aug 2026):

| model | time |
|---|---|
| `google/gemma-4-26b-a4b-it:free` | ~5s |
| `nvidia/nemotron-3-super-120b-a12b:free` | ~17s |
| `openai/gpt-oss-20b:free` | ~18s |
| `nvidia/nemotron-nano-9b-v2:free` | ~37s |

All four support strict structured output, which is mandatory here — the app forces a JSON schema
rather than parsing prose, so a model without it fails every call. **Set `OPENROUTER_MODEL` to the
gemma model if you want the app to feel fast**; the default is ~3.5x slower.

Because fallback changes which model judged, each score records the model that produced it, and the
summary warns when an interview was judged by more than one — scores from different judges are not
directly comparable. A rejected API key stops the chain immediately instead of failing three times.

## Request budget

OpenRouter's free tier allows **20 requests/minute and 50 requests/day** without credits. It rises
to 1000/day once you have purchased $10 of credits at any point.

One interview costs **1 request to generate the questions, plus 1 per answer you submit** — so 4 at
most, and roughly **12 interviews per day** on the free tier. Skipping a question makes no call, so
an interview where you skip everything costs the single generation request.

## How it works

1. `/` — pick AI Engineer or Software Engineer. One call to `/api/generate-questions` returns three
   questions.
2. `/interview` — one question at a time. Submitting advances immediately; the `/api/score-answer`
   call runs in the background while you answer the next question, so you never wait on the judge.
   Forward-only: submitted answers are final and there is no going back. **Skip question** records
   the skip and advances without calling the judge.
3. `/summary` — all scores, shown only here. Each question gets its three scores, feedback, a
   **suggested answer** written to the same length budget, and your own answer. Skipped questions
   are listed as skipped and excluded from the averages entirely — counting them as zero would make
   skipping look identical to answering wrongly. Answers whose scoring failed, or that are still in
   flight, are labelled as such and can be scored from a button rather than silently retried.

The bookmark icon beside a question saves it to `localStorage` under `mock-interview-bookmarks`,
along with its topic label, the role, and — once scoring finishes — the suggested answer. When a
new interview is generated, each question has a `NEXT_PUBLIC_REUSE_CHANCE` probability of being
replaced by a saved one for that role, so material you flagged comes back. A saved question is
never used twice in the same interview, and never displaces an identical one.

The interview session itself lives in `sessionStorage` under `mock-interview-session`. There is no
database and no account. Closing the tab ends the interview; bookmarks outlive it.

**When a call fails, it fails.** No automatic retry, no fallback parsing of a mangled response, no
defaulting a score to zero. A fabricated score is indistinguishable from a real one in the summary,
so the app shows the error and lets you decide whether to spend another request.

## Tests

```bash
cd app
npm test            # requires Node >= 22.6 for TypeScript stripping
npx tsc --noEmit
npm run build
```

Twenty-one tests, covering the two pieces of logic that can silently produce a wrong number: judge
response validation with per-criterion averaging including skips (`lib/score.ts`), and
stored-session validation (`lib/session.ts`). Everything else is a thin wrapper around an HTTP call and is verified by
running the app.

## Notes

`/api/score-answer` and `/api/generate-questions` are unauthenticated. That is fine on localhost,
but anyone who can reach a deployed instance can spend your daily request quota. Put auth in front
of it before hosting it anywhere public.

## Experiments

`experiments/` is a Kedro pipeline measuring **question quality**, the thing this product lives or
dies on. Every free OpenRouter model writes questions for the same 15-subject assignment, a human
rates each one 1–5 blind, and results accumulate so any run can be compared with any future run.

It is isolated from the app — its own venv, its own key, its own copy of the prompt. It never
imports from `app/`, so a finding reaches production only when someone hand-ports it into
`app/lib/prompts.ts`. A full run costs 5 requests against the 50/day cap; the real cost is the
15–25 minutes of human rating. See [experiments/README.md](experiments/README.md).
