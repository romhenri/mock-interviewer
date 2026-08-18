"""Nodes for the question-generation experiment."""

from __future__ import annotations

import datetime as dt
import random
import uuid
from contextlib import contextmanager

import mlflow
from mlflow.tracing.constant import SpanAttributeKey

from question_experiments import store
from question_experiments.openrouter import (
    NO_USAGE,
    FatalError,
    GenerationError,
    chat_json,
    load_api_key,
)
from question_experiments.prompts import CLIENT_SETTINGS, PROMPT_VERSION, render


def _tracking() -> bool:
    """Whether kedro-mlflow has a run open around this node.

    Every mlflow call below is guarded by it, because the tests call these nodes directly and
    `log_metric` with no active run does not no-op — it opens one, filing test fixtures in the
    same experiment as real results.
    """
    return mlflow.active_run() is not None


@contextmanager
def _span(name: str, **kwargs):
    """One trace span per request, or nothing at all when not tracking. See `_tracking`."""
    if not _tracking():
        yield None
        return
    with mlflow.start_span(name=name, **kwargs) as span:
        yield span


def build_run_config(params: dict) -> dict:
    """Renders the prompt once and freezes it for every model in the run.

    All models must receive a byte-identical prompt or the comparison measures the prompt
    as much as the model, so it is rendered here and passed down rather than rebuilt
    per model.
    """
    params = store.named_config(params)

    subjects = params["subjects"]
    if len(set(subjects)) != len(subjects):
        raise ValueError(f"duplicate subjects in parameters: {subjects}")

    # Seeded, so the sample is a property of the config rather than of the moment the run
    # started: every model in the run gets the same three subjects (that is the whole
    # design), and tomorrow's run gets them too, so its rows pool with today's instead of
    # landing in a table of one. An unseeded sample would move config_hash every run.
    if params.get("sample"):
        subjects = random.Random(params["sample_seed"]).sample(subjects, params["sample"])

    prompt, schema, hashed = render(params, subjects)
    started = dt.datetime.now(dt.timezone.utc)

    # Timestamp for sortability, random suffix for uniqueness. Seconds alone collide when
    # two runs start in the same second, and a collision is silent and expensive: run_id
    # seeds question_id, so the second run's questions would inherit the first run's
    # ratings and overwrite its manifest.
    run_id = f"{started.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:6]}"

    config = {
        "run_id": run_id,
        "started_at": started.isoformat(),
        # The file this run came from, if it came from one. `config_hash` says two runs are
        # comparable; this says which config a human can re-run to get more of them.
        "config": params.get("config"),
        "config_hash": hashed,
        # The template a custom prompt came from, kept apart from the rendered text: only
        # the template can be re-rendered for another subject list, and only the rendered
        # text says what the models were actually asked. `trace.py` needs the first one.
        "prompt_version": PROMPT_VERSION if params.get("prompt") is None else "custom",
        "prompt_template": params.get("prompt"),
        "answer_length": params.get("answer_length"),
        **{key: params.get(key) for key in CLIENT_SETTINGS},
        "prompt": prompt,
        "schema": schema,
        "role": params["role"],
        "level": params["level"],
        "subjects": subjects,
        "models": params["models"],
    }

    if _tracking():
        # The resolved config, not conf/base — a run launched with `experiment.config=x` took
        # every value from that file. `config_hash` is the one to filter the UI on: it is what
        # says two runs measured the same task and may be compared.
        mlflow.log_params(
            {
                key: config[key]
                for key in ("run_id", "config", "config_hash", "prompt_version", "role", "level",
                            "answer_length", *CLIENT_SETTINGS)
            }
            | {"n_subjects": len(subjects), "n_models": len(config["models"])}
        )
        # Long and never filtered on, so they are artifacts rather than params: the prompt is
        # past mlflow's 250-char limit on its own, and the lists are what the manifest is for.
        mlflow.log_text(prompt, "prompt.txt")

    return config


def generate_questions(config: dict) -> list[dict]:
    """One request per model, each pinned — no fallback chain.

    The loop lives inside the node because Kedro's DAG is static: a node per model would
    have to be generated at build time by a factory, which buys a prettier graph and costs
    a pipeline-generation layer to debug whenever a run misbehaves.

    A model that fails both attempts contributes a single row carrying `error`, so its
    failure rate survives into the report instead of looking like an absent model.
    """
    api_key = load_api_key()
    rows: list[dict] = []

    for model in config["models"]:
        # One MLflow run per request, because the request is the thing being compared. The
        # batch is not: it holds five models whose only relationship is having been launched
        # together, and folding them into one row forces the model into the metric *name*
        # (`latency_ms.<model>`). A name cannot be grouped, filtered or averaged — which is
        # how a table of two configs quietly averages into a number describing neither.
        with _request_run(config, model):
            mine = _request(config, model, api_key)
            if _tracking():
                mlflow.log_metrics(_request_metrics(mine, config))
        rows.extend(mine)

    return rows


@contextmanager
def _request_run(config: dict, model: str):
    """The nested run one request is logged to, or nothing at all when not tracking.

    Nested rather than flat so the batch keeps a parent to hang its totals and its manifest
    on, and so the UI still collapses a run's requests under the run that launched them.

    The params are what makes the child findable and groupable: `run_id` joins it back to
    the manifest and to `metrics.py`, `config_hash` says which requests are comparable, and
    `model` is the column every analysis groups by.
    """
    if not _tracking():
        yield None
        return
    with mlflow.start_run(nested=True, run_name=model) as run:
        mlflow.log_params(
            {
                "run_id": config["run_id"],
                "model": model,
                "config": config["config"],
                "config_hash": config["config_hash"],
            }
        )
        yield run


def _request(config: dict, model: str, api_key: str) -> list[dict]:
    """One model's request, as the rows it produced — questions, or a single failure row."""
    rows: list[dict] = []
    # One span per request, so MLflow's trace view shows what each model was sent, what it
    # sent back and how long it took — including the failures, which are the rows a
    # rating pass never sees and the ones worth reading a trace for.
    with _span(model, span_type="LLM") as span:
        if span:
            span.set_inputs({"model": model, "prompt": config["prompt"]})
        try:
            body, latency_ms, usage = chat_json(
                model,
                config["prompt"],
                config["schema"],
                api_key,
                **{key: config[key] for key in CLIENT_SETTINGS},
            )
        except FatalError:
            # A rejected key is not a result about this model. Recording it as one would
            # file five identical "failures" and invite the conclusion that every model
            # is broken.
            raise
        except GenerationError as error:
            rows.append(_failure_row(config, model, str(error)))
            if span:
                span.set_outputs({"error": str(error)})
                _mark_failed(span)
            return rows

        questions = body.get("questions")
        if not isinstance(questions, list) or not questions:
            failure = f"no questions in response: {str(body)[:120]}"
            # Usage rides along: the request was paid for whether or not it answered,
            # and a cost column that skipped the duds would understate the bill.
            rows.append(_failure_row(config, model, failure, usage))
            if span:
                span.set_outputs({"error": failure})
                _log_tokens(span, usage)
                _mark_failed(span)
            return rows

        if span:
            span.set_outputs({"questions": questions, "latency_ms": latency_ms, **usage})
            _log_tokens(span, usage)

    # A short response is kept, not discarded. A strict schema guarantees a count only
    # when the provider honours it, and the free pool includes providers that do not —
    # but 14 usable questions are 14 usable questions, and throwing them away would
    # both waste the request and hide the shortfall behind a blanket failure. The gap
    # stays visible in the report as questions produced against subjects assigned.
    rows.extend(_question_rows(config, model, questions[: len(config["subjects"])], latency_ms, usage))

    return rows


def _mark_failed(span) -> None:
    """Turns the span red, which catching the exception here otherwise prevents.

    MLflow marks a span ERROR when the exception leaves the `start_span` block, and this
    node catches it on purpose — a rate-limited model is a result, not a crashed pipeline.
    The status is set by hand instead, so a failed request is filterable in the UI
    (`trace.status = 'ERROR'`) rather than an OK span with an error buried in its outputs.
    """
    span.set_status("ERROR")


def _log_tokens(span, usage: dict) -> None:
    """Puts the token counts where MLflow's trace UI looks for them.

    This one attribute is what fills the token columns and totals a trace's usage across
    its spans, so it is set rather than hand-logged as metrics. Skipped when the provider
    reported no counts — a zero there reads as a free request.
    """
    prompt, completion = usage["prompt_tokens"], usage["completion_tokens"]
    if prompt is None and completion is None:
        return
    span.set_attribute(
        SpanAttributeKey.CHAT_USAGE,
        {
            "input_tokens": prompt or 0,
            "output_tokens": completion or 0,
            "total_tokens": (prompt or 0) + (completion or 0),
        },
    )


def _question_rows(
    config: dict, model: str, questions: list[dict], latency_ms: int, usage: dict | None = None
) -> list[dict]:
    """One row per question the model returned.

    `subject` is the subject the model tagged, never the slot it landed in. Compliance is
    about *coverage* — did every assigned subject get a question — and a model that answers
    all 15 in a different order has complied. Scoring position instead would report a
    reordered-but-complete set as 0% compliant, which is a false finding about the exact
    thing the column exists to measure. The assigned slot is therefore not recorded; it is
    in the run manifest if a question about ordering ever needs answering.

    `n_subjects` rides along so the report can compute coverage without reopening the
    manifest for every row.

    Tokens and cost belong to the *request*, not the question, so they repeat on every row
    it produced — the same shape `latency_ms` already has. Readers take them from one row
    per model; summing the column would multiply the bill by the number of questions.
    """
    return [
        {
            "question_id": store.question_id(config["run_id"], model, index),
            "run_id": config["run_id"],
            "config_hash": config["config_hash"],
            "model": model,
            "subject": str(item.get("subject", "")),
            "n_subjects": len(config["subjects"]),
            "index": index,
            "text": str(item.get("question", "")),
            # Named apart from `text` because both are prose and confusing them silently
            # swaps what gets rated. `answer` is the schema's key, this is the row's.
            "suggested_answer": str(item.get("answer", "")),
            "latency_ms": latency_ms,
            **(usage or NO_USAGE),
            "error": None,
        }
        for index, item in enumerate(questions)
    ]


def _failure_row(config: dict, model: str, error: str, usage: dict | None = None) -> dict:
    return {
        "question_id": store.question_id(config["run_id"], model, -1),
        "run_id": config["run_id"],
        "config_hash": config["config_hash"],
        "model": model,
        "subject": None,
        "n_subjects": len(config["subjects"]),
        "index": -1,
        "text": None,
        "suggested_answer": None,
        "latency_ms": None,
        **(usage or NO_USAGE),
        "error": error,
    }


def persist_run(rows: list[dict], config: dict) -> dict:
    """Appends the rows and writes the run manifest.

    The manifest carries the full prompt text. `config_hash` says two runs are comparable;
    the prompt text says *what* they measured, months later when the file has moved on.
    """
    store.append(store.QUESTIONS, rows)

    failed = sorted({row["model"] for row in rows if store.failed(row)})
    summary = {
        "run_id": config["run_id"],
        "started_at": config["started_at"],
        "config": config["config"],
        "config_hash": config["config_hash"],
        "prompt_version": config["prompt_version"],
        "prompt_template": config["prompt_template"],
        "answer_length": config["answer_length"],
        **{key: config[key] for key in CLIENT_SETTINGS},
        "role": config["role"],
        "level": config["level"],
        "models": config["models"],
        "subjects": config["subjects"],
        "questions_written": sum(1 for row in rows if not store.failed(row)),
        "failed_models": failed,
        **_run_totals(rows),
        "prompt": config["prompt"],
    }
    path = store.write_manifest(config["run_id"], summary)

    if _tracking():
        mlflow.log_artifact(str(path))
        mlflow.log_metrics(
            {
                "questions_written": summary["questions_written"],
                "models_failed": len(failed),
                # What this run cost, in one number, which is the whole point of the
                # column: the UI sorts and charts runs by it.
                **_run_totals(rows),
            }
        )
        # The questions themselves, as a table rather than a blob: MLflow renders it, so the
        # run is readable in the UI without opening data/questions.jsonl beside it. This is a
        # view of the JSONL, never the record — `store.append` above is that.
        mlflow.log_table(
            {
                key: [row[key] for row in rows]
                for key in ("model", "subject", "text", "suggested_answer", "latency_ms",
                            "prompt_tokens", "completion_tokens", "cost_usd", "error")
            },
            "questions.json",
        )

    return summary


def _request_metrics(rows: list[dict], config: dict) -> dict[str, float]:
    """What one request is worth measuring by, as plain metric names on its own run.

    Plain because the model is a param here, not a suffix: `latency_ms` on fifty request
    runs is a column you group by model and average, which `latency_ms.<model>` on ten batch
    runs is not. Objective columns only — quality is a human rating that does not exist yet
    when this run ends, and `metrics.py --mlflow` logs it back onto this same run later.

    `covered` is distinct subjects over subjects assigned, the same definition metrics.py
    uses: a model that writes three questions about RAG and skips Diffusion Models produced
    a full set of rows while covering less of the assignment.
    """
    produced = [row for row in rows if not store.failed(row)]
    # One request per model, so its cost and usage sit identically on every row it produced.
    # Read from the first, never summed. A failed request is charged too, which is why this
    # reads `rows` rather than `produced`.
    first = rows[0]

    metrics: dict[str, float] = {
        "failed": 0 if produced else 1,
        "questions_written": len(produced),
    }
    if first.get("cost_usd") is not None:
        metrics["cost_usd"] = first["cost_usd"]
    if _tokens(first) is not None:
        metrics["tokens"] = _tokens(first)
        metrics["completion_tokens"] = first["completion_tokens"] or 0
        metrics["prompt_tokens"] = first["prompt_tokens"] or 0

    if not produced:
        return metrics

    metrics["latency_ms"] = produced[0]["latency_ms"]
    metrics["covered"] = len({row["subject"] for row in produced}) / len(config["subjects"])

    # Latency alone ranks a model that wrote 234 tokens above one that wrote 1138, and calls
    # the first faster. It measured a shorter answer. This is the column that separates the
    # two, and the only one of the pair worth comparing across configs.
    if metrics.get("completion_tokens") and produced[0]["latency_ms"]:
        metrics["tokens_per_sec"] = metrics["completion_tokens"] / (produced[0]["latency_ms"] / 1000)
    return metrics


def _tokens(row: dict) -> int | None:
    """Prompt plus completion, or None when the provider reported neither."""
    prompt, completion = row.get("prompt_tokens"), row.get("completion_tokens")
    if prompt is None and completion is None:
        return None
    return (prompt or 0) + (completion or 0)


def _run_totals(rows: list[dict]) -> dict[str, float]:
    """`cost_usd` and `tokens` for the whole run — what this experiment cost to run once.

    One row per model, because one request per model: the rows repeat the request's cost
    for every question it produced, and summing the column would bill each question
    separately.
    """
    per_model = {}
    for row in rows:
        per_model.setdefault(row["model"], row)
    return {
        "cost_usd": sum(row.get("cost_usd") or 0 for row in per_model.values()),
        "tokens": sum(_tokens(row) or 0 for row in per_model.values()),
    }
