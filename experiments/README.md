# Question generation experiments

The product is only as good as the questions it generates. This project measures that:
every free OpenRouter model writes questions for the **same** assignment, a human rates each
question 1–5 blind, and the results accumulate so any run can be compared with any future run.

Isolated from `app/` on purpose — its own venv, its own key, its own copy of the prompt. It
never imports from the app and never modifies it.

## Setup

```bash
cd experiments
python3 -m venv .venv
.venv/bin/pip install -e .
cp .env.example .env      # then paste your OpenRouter key into it
```

## The loop

```bash
.venv/bin/kedro run       # 5 models x 1 request = 75 questions
.venv/bin/python rate.py  # rate them 1-5, blind, resumable
.venv/bin/python metrics.py
```

To read the questions side by side instead of as a score — one row per subject, one column
per model — serve the folder and open the viewer. It is plain HTML over the same JSONL, so
there is nothing to build:

```bash
python3 -m http.server 8000     # from experiments/
open http://localhost:8000/web_view.html
```

Do this **after** rating, not before: it shows model names, and `rate.py` is blind for a
reason.

```
config ac57beed9a04 — 2 run(s): 20260812T2312Z-a1b2c3, 20260813T0904Z-9f8e7d
  model                                       quality   stdev  rated  covered   fail   latency
  --------------------------------------------------------------------------------------------
  google/gemma-4-26b-a4b-it:free                 4.20    0.68  15/15     100%     0%    5100ms
  liquid/lfm-2.5-2.6b:free                       2.10    1.04  15/15      73%    50%     900ms
```

`quality` is the mean human rating. `covered` is how much of the assignment the model actually
answered — distinct subjects, so writing three questions about RAG and skipping Diffusion Models
shows up as a gap rather than a full set. Order is not compliance. `fail` counts requests that
produced nothing usable — a model that cannot hold a schema is a finding, not an error to be
swallowed, and a model that returns 14 of 15 keeps its 14.

## Design

**One assignment, every model.** All 15 AI Engineer subjects, one question each, so a rating
compares model A's RAG question against model B's RAG question rather than comparing which
subjects each chose. Set in `conf/base/parameters.yml`.

**Each question comes back with the answer its author would accept**, in the same request —
so it costs nothing and no second model's opinion gets mixed in. `rate.py` shows it under the
question. It is what makes a question judgeable: one that cannot be answered in 2–3 sentences,
or whose own model answer just restates it, is a bad question and now says so on screen.

**The model is pinned per request.** The app's client falls through four models when one is
rate-limited; this one fails instead. A silent fallback would file gemma's questions under
nemotron's name, which is the one thing this experiment cannot survive.

**Rating is blind.** `rate.py` pools every model's questions, shuffles them, and never prints
who wrote one. You picked the models — seeing the name is enough to move a 3 to a 4.

**Ratings and questions are separate append-only files.** Re-running the pipeline can never
overwrite hand-collected ratings. Re-rating appends; the later rating wins.

**`config_hash` decides what is comparable.** It hashes the rendered prompt, which contains
the role, level, subject list and wording. Edit any of them and new runs get their own table
rather than being averaged with the old ones — they measured a different task.

**Rating is not a Kedro node.** A node that blocks on keypresses makes `kedro run`
un-runnable unattended, so `rate.py` and `metrics.py` sit outside the graph and read its files.

## Layout

```
conf/base/parameters.yml   role, level, subjects, models — the experiment definition
src/question_experiments/
  prompts.py               prompt v1 (forked from app/lib/prompts.ts) + config_hash
  openrouter.py            pinned-model client, one retry, no fallback
  store.py                 append-only JSONL + run manifests
  pipelines/generate/      the DAG: build config -> generate -> persist
rate.py                    interactive 1-5 rating, blind and resumable
metrics.py                 mean quality per model, per config
web_view.html              questions side by side, one column per model — no build, no deps
test_experiments.py        self-checks — python test_experiments.py
data/
  questions.jsonl          every question ever generated
  ratings.jsonl            every rating ever given
  runs/<run_id>/manifest.yml   what that run was, including the full prompt
```

## Budget

OpenRouter's free tier is 20 requests/minute and 50/day. One full run is **5 requests** — one
per model. The cost is human: 75 questions is roughly 15–25 minutes of rating.

The model list was checked in August 2026 and the free tier turns over. Re-check with
`curl -s https://openrouter.ai/api/v1/models` before trusting it.

## Known limits

- **The prompt is a fork.** A finding here does not reach the app until someone hand-ports it
  into `app/lib/prompts.ts`. That is the price of isolation.
- **One sample per model per run**, so a single run measures a model's output, not its
  consistency. Re-run the same parameters and `metrics.py` pools them automatically.
- **One rater, one axis.** Mean quality with n=15 has a wide confidence interval; treat a
  0.3 gap between two models as noise. `liquid/lfm-2.5-2.6b` is in the list as a sanity
  floor — if it does not score below the rest, the scale is not discriminating.
