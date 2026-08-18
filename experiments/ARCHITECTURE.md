# Architecture

The Kedro pipeline that measures question quality: every free OpenRouter model writes questions
for the same assignment, a human rates each one 1–5 blind, and results accumulate so any run can
be compared with any future run. Folder framing — every box is a directory, except the two
scripts that sit outside the DAG on purpose.

```
┌──────────┐    ┌────────────┐
│ generate │    │  rate.py   │
│ pipeline │    │ metrics.py │
└──────────┘    └────────────┘
      │                │
      └────────┬───────┘
               ▼ imports
   ┌──────────────────────┐  HTTPS  ┌────────────────┐
   │ question_experiments │ ◀─────▶ │ OpenRouter API │
   └──────────────────────┘         └────────────────┘
               │
               ├────────────────────────┐
               ▼ JSONL                  ▼ kedro-mlflow
     ┌──────────────────┐     ┌────────────────────┐
     │ experiments/data │     │ mlflow.db, mlruns/ │
     └──────────────────┘     └────────────────────┘
```

Vertical arrows are one-way: code depends downward, and `data/` is where the run ends up.
OpenRouter sits to the side on a two-way arrow because it is neither — a blocking
request/response the pipeline waits on mid-node, not something this project produces.

## The boxes

**generate pipeline** — `src/question_experiments/pipelines/generate/`. Three nodes:
`build_run_config` → `generate_questions` → `persist_run`. The experiment definition it runs on
is `conf/base/parameters.yml`, not code.

**rate.py / metrics.py** — outside the DAG deliberately: a node that blocks on human keypresses
makes `kedro run` un-runnable unattended. They reach the pipeline's output through `store`, so
they are downstream of it by data, not by import.

**question_experiments** — `src/question_experiments/`. `prompts.py` (prompt v1 plus
`config_hash`), `openrouter.py` (pinned model, one retry, no fallback), `store.py` (append-only
JSONL and run manifests).

**mlflow.db / mlruns/** — the MLflow tracking store, written by the kedro-mlflow plugin plus
the explicit logging in `nodes.py`. Two levels, because the request is what gets compared and
the batch is not. A parent run per `kedro run` carries the resolved config as params, the
batch totals `cost_usd` and `tokens` (what one execution cost), and the manifest, prompt and
questions table as artifacts. Nested under it, one run per request carries `model`,
`config_hash` and `run_id` as params and `latency_ms`, `covered`, `tokens_per_sec`, tokens,
cost and `failed` as plain metrics, plus its trace span. Plain names on a child rather than
`latency_ms.<model>` on the parent: the model has to be a value to be grouped, filtered and
averaged, and a name cannot be. Cost is OpenRouter's own figure, requested with `usage.include`
and read off the response, not tokens multiplied by a price list kept here. `metrics.py
--mlflow` adds the human ratings to the request runs afterwards, matching on
(`run_id`, `model`). [MLFLOW-HOWTO.md](MLFLOW-HOWTO.md) is the usage
guide, [conf/base/mlflow.yml](conf/base/mlflow.yml) the settings.

A **view**, not a record — both paths are gitignored and rebuildable, and nothing reads from
them. `data/` below stays the source of truth, which is why the plugin's own dataset types are
not used: a result that only exists inside MLflow would be a result the rater cannot reach.

**experiments/data** — `questions.jsonl`, `ratings.jsonl`, `runs/<run_id>/manifest.yml`.
Append-only, which is what lets re-running the pipeline never overwrite hand-collected ratings.
Not written through the Kedro catalog — `catalog.yml` is empty on purpose, since versioned
datasets would turn "compare any run to any future run" into a directory crawl.

## Worth noting

`openrouter.py` is the opposite of the app's client by design: the app falls through four models
when one is rate-limited, this one fails instead. A silent fallback would file one model's
questions under another's name, which is the one thing this experiment cannot survive.

`prompts.py` is a fork of `app/lib/prompts.ts`, and nothing here imports from `app/`. That
isolation is why a finding reaches production only when someone hand-ports it — see
[../app/ARCHITECTURE.md](../app/ARCHITECTURE.md).
