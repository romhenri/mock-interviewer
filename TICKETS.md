# Mock Interviewer — Tickets

Settled spec (from grilling session, 2026-08-09):

- **Model:** `openai/gpt-oss-20b:free` (free tier, strict structured output), overridable via `OPENROUTER_MODEL`
- **Budget:** OpenRouter free tier, no credits = **20 req/min, 50 req/day**. One interview = 4 requests (1 generate + 3 judge) → ~12 interviews/day
- **Stack:** Next.js app router, TypeScript, Tailwind, npm
- **State:** `sessionStorage` key `mock-interview-session` = `{ role, questions[], answers[], scores[] }`
- **Kedro experiments:** deferred to `experiments-plan.md`, not built this session

---

## 01 — Role selection → generated questions

**Blocked by:** None — can start immediately

**What to build:** A visitor opens the app, sees two role cards (AI Engineer, Software Engineer), picks one, and lands on the interview page looking at three real interview questions generated for that role by OpenRouter. Questions come from a single server-side call; the API key never reaches the browser.

**Status:** ready-for-agent

- [x] `git init` at repo root with a `.gitignore` covering `node_modules`, `.next`, `.env.local`
- [x] Next.js app scaffolded under `app/` — npm, TypeScript, Tailwind, app router
- [x] `lib/types.ts` defines the question, answer, and score shapes
- [x] `lib/openrouter.ts` is a fetch-based client hitting `https://openrouter.ai/api/v1/chat/completions`, sending `response_format` with a strict JSON schema
- [x] `lib/prompts.ts` holds the question-generator prompt template, parameterised by role
- [x] `/api/generate-questions` returns exactly 3 questions for a given role
- [x] Role selection page lists the two roles and navigates on selection
- [x] Session (`role` + `questions`) is written to `sessionStorage` under `mock-interview-session`
- [x] Landing on the interview route with no session in storage redirects to the role list
- [x] A missing `OPENROUTER_API_KEY` produces a clear error, not a crash or a silent empty state
- [x] `.env.local.example` documents `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`

---

## 02 — experiments-plan.md

**Blocked by:** None — can start immediately

**What to build:** A decision record someone can pick up later and build the Kedro pipeline from without redoing the grilling. Mid detail: settled decisions plus a `parameters.yml` and catalog sketch, no node pseudocode.

**Status:** ready-for-agent

- [x] Names the comparison set: the 4 free models that support structured output (`openai/gpt-oss-20b`, `google/gemma-4-26b-a4b-it`, `nvidia/nemotron-nano-9b-v2`, `nvidia/nemotron-3-super-120b-a12b`)
- [x] States the 4 nodes: `generate_questions`, `generate_sample_answer`, `score_answer`, `compare_report`
- [x] Records the sweep axis: question and answer generation are **fixed to one model**, only the judge is swept — so one variable moves at a time
- [x] Records prompt versioning: v1 = plain judge persona, v2 = explicit scoring rubric with per-band definitions; the measured question is whether the rubric reduces score variance
- [x] Records that structured output is forced and parse failures are **counted as a result**, never regex-scraped into a score
- [x] Records that the model × prompt sweep is a plain loop **inside one node**, not a namespaced pipeline factory
- [x] Includes the request-budget table showing a full 4-model × 2-prompt × 3-question grid costs **56 calls** and does not fit in 50/day, with the reduced default that does
- [x] Includes a `parameters.yml` sketch (topic, models, prompt_version, num_questions, difficulty) and a catalog sketch with versioned datasets
- [x] Notes that `topic` and `difficulty` are experiment-side knobs with no app equivalent yet

---

## 03 — Answer → immediate 3-criteria score

**Blocked by:** 01

**What to build:** The candidate types an answer to the current question and submits it. A judge call scores it on correctness, clarity, and depth (0–100 each) plus written feedback, and the result appears immediately below the question. "Next question" moves forward; there is no going back.

**Status:** ready-for-agent

- [x] Answer textarea with a submit control disabled for empty or whitespace-only input
- [x] `lib/prompts.ts` gains the judge prompt template
- [x] `/api/score-answer` takes question + answer and returns `{ correctness, clarity, depth, feedback }` under a strict JSON schema
- [x] Scores and feedback render immediately after submission, before the next question
- [x] Answer and score are appended to the session in `sessionStorage`
- [x] Advancing is forward-only — no back navigation, submitted answers are final
- [x] A judge failure surfaces an honest error message — **no automatic retry, no fallback parsing, no defaulting to 0**
- [x] Submission shows a loading state while the judge call is in flight

---

## 04 — Summary screen

**Blocked by:** 03

**What to build:** After the third answer, the candidate reaches a summary showing how they did across the whole interview — every question with its three scores and feedback, plus the average per criterion — and can start a fresh interview from there. First point the full flow is demoable end to end.

**Status:** ready-for-agent

- [x] Completing the last question navigates to the summary route
- [x] Per-question breakdown lists each question with its correctness, clarity, and depth scores and its feedback
- [x] Overall average per criterion is shown across all three questions
- [x] "Start over" clears `sessionStorage` and returns to the role list
- [x] Landing on the summary route with no session redirects to the role list
- [x] Full path verified end to end against live OpenRouter: both API routes exercised against a
      real key — question generation returns three on-subject questions, the judge returns valid
      scores, feedback and a suggested answer. The browser click-through itself was not driven.

---

## 05 — README

**Blocked by:** 01, 02, 03, 04

**What to build:** Someone with a fresh clone and an OpenRouter key can get the app running without asking anyone a question.

**Status:** ready-for-agent

- [x] Explains what the project is in a couple of lines
- [x] Documents getting an OpenRouter key and setting `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` in `app/.env.local`
- [x] Documents install and run (`npm install`, `npm run dev`) and the URL to open
- [x] States the free-tier budget: 20 req/min, 50 req/day without credits; 4 requests per interview
- [x] Points at `experiments-plan.md` and says plainly that the Kedro pipeline is designed but not built

---

## 06 — Skip a question

**Blocked by:** 03, 04 (added after the original batch)

**What to build:** The candidate can move past a question without answering it, and doing so costs
no API request. Skipped questions appear in the summary as skipped rather than as a zero.

**Status:** done

- [x] "Skip question" on the interview page records the skip and advances
- [x] Skipping makes **no** call to `/api/score-answer` — an all-skipped interview spends only the
      one generation request
- [x] Session stores a skip as `null` in both `answers` and `scores`, keeping the indices in lockstep
- [x] Summary lists skipped questions as skipped, with no scores or feedback
- [x] Skipped questions are excluded from the per-criterion averages — not counted as zero
- [x] Summary header shows answered vs. skipped counts
- [x] An interview where every question was skipped still reaches the summary and says so, instead
      of showing three zeroes

---

## Notes carried from the grilling session

- `meta-llama/llama-3.1-8b-instruct:free` **no longer exists** on OpenRouter — there is no free Llama and no free Mistral. Any plan naming them needs rewriting against the current 14-model free tier.
- Showing scores after each question means question 3 is answered by someone who just saw their question 2 grade. Deliberate choice; it is a measurement artifact, not a bug.
- `experiments-plan.md` is written against a pipeline nobody has run. The 56-call arithmetic will survive contact with reality; the prompt-version design probably won't.
