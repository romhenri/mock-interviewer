# Mock Interviewer

Pick a role, answer three generated interview questions in two or three sentences each, get each
answer scored 0–100 on correctness, clarity and depth by an LLM judge. Questions and scoring both run through
[OpenRouter](https://openrouter.ai); the API key stays server-side.

```
mock-interviewer/
├── app/                  Next.js app — the thing you run
├── experiments-plan.md   Kedro pipeline design (not built)
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

Open http://localhost:3000.

`.env.local` holds two variables:

| Variable | Required | Default |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | — |
| `OPENROUTER_MODEL` | no | `openai/gpt-oss-20b:free` |

The default is a free model that supports strict structured output. Three other free models do too
and can be swapped in without code changes: `google/gemma-4-26b-a4b-it:free`,
`nvidia/nemotron-nano-9b-v2:free`, `nvidia/nemotron-3-super-120b-a12b:free`. A model that does
*not* support structured output will fail every call — the app forces a JSON schema rather than
parsing prose.

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

The whole session lives in `sessionStorage` under `mock-interview-session`. There is no database
and no account. Closing the tab ends the interview.

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

Fourteen tests, covering the two pieces of logic that can silently produce a wrong number: judge
response validation with per-criterion averaging including skips (`lib/score.ts`), and
stored-session validation (`lib/session.ts`). Everything else is a thin wrapper around an HTTP call and is verified by
running the app.

## Notes

`/api/score-answer` and `/api/generate-questions` are unauthenticated. That is fine on localhost,
but anyone who can reach a deployed instance can spend your daily request quota. Put auth in front
of it before hosting it anywhere public.

## Experiments

`experiments-plan.md` designs a Kedro pipeline for comparing free OpenRouter models and judge
prompt versions — which model is the most *consistent* judge, and whether an explicit rubric
reduces score variance.

**It is a design document. The pipeline is not built and has never been run.** It carries the
request-budget arithmetic (a full four-model grid costs 56 calls against a 50/day cap), the catalog
and parameter sketches, and the open questions — most importantly that measuring judge consistency
properly needs the same answer scored repeatedly, which multiplies the request count.
