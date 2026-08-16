# Mock Interviewer

Pick a role, answer three generated interview questions in two or three sentences each, get each
answer scored 0–100 on correctness, English and depth by an LLM judge. Questions and scoring both run through
[OpenRouter](https://openrouter.ai); the API key stays server-side.

```
mock-interviewer/
├── app/                  Next.js app — the thing you run
├── experiments/          Kedro pipeline measuring question quality
```

## Setup

You need an OpenRouter API key: https://openrouter.ai/keys

```bash
cd app
npm install
npm run dev
```

Open http://localhost:4242.

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

Every generated question is cached in `localStorage` under `mock-interview-bookmarks` — the
question, its topic label, the role, and the full-credit answer it was generated with. Generation
is the part that costs a request, so its output is always kept; the bookmark icon on the summary
discards a question you do not want back (and puts it back if you change your mind). Settings →
**Questions source** decides where a new interview draws from: *Complete generation* asks the model
for a fresh set, *Only cache* draws from what is already stored for that role, and *Ground truth*
draws from the fixed set in `app/public/data/ground-truth.json`. Neither of the last two spends a
request. A cached question is never used twice in the same interview. `/cache` lists everything held.

The interview session itself lives in `sessionStorage` under `mock-interview-session`. There is no
database and no account. Closing the tab ends the interview; the cache outlives it.

**When a call fails, it fails.** No automatic retry, no fallback parsing of a mangled response, no
defaulting a score to zero. A fabricated score is indistinguishable from a real one in the summary,
so the app shows the error and lets you decide whether to spend another request.

## Experiments

`experiments/` is a Kedro pipeline measuring **question quality**, the thing this product lives or
dies on. Every free OpenRouter model writes questions for the same 15-subject assignment, a human
rates each one 1–5 blind, and results accumulate so any run can be compared with any future run.
Every run is tracked in MLflow through kedro-mlflow, so the UI shows the configs side by side,
the per-model numbers, and a trace of each model's request —
[experiments/MLFLOW-HOWTO.md](experiments/MLFLOW-HOWTO.md).

It is isolated from the app — its own venv, its own key, its own copy of the prompt. It never
imports from `app/`, so a finding reaches production only when someone hand-ports it into
`app/lib/prompts.ts`. [experiments/README.md](experiments/README.md).
