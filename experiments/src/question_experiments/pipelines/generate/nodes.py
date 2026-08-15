"""Nodes for the question-generation experiment."""

from __future__ import annotations

import datetime as dt
import uuid

from question_experiments import store
from question_experiments.openrouter import FatalError, GenerationError, chat_json, load_api_key
from question_experiments.prompts import (
    PROMPT_VERSION,
    config_hash,
    questions_prompt,
    questions_schema,
)


def build_run_config(params: dict) -> dict:
    """Renders the prompt once and freezes it for every model in the run.

    All models must receive a byte-identical prompt or the comparison measures the prompt
    as much as the model, so it is rendered here and passed down rather than rebuilt
    per model.
    """
    subjects = params["subjects"]
    if len(set(subjects)) != len(subjects):
        raise ValueError(f"duplicate subjects in parameters: {subjects}")

    prompt = questions_prompt(params["role"], params["level"], subjects)
    schema = questions_schema(subjects)
    started = dt.datetime.now(dt.timezone.utc)

    # Timestamp for sortability, random suffix for uniqueness. Seconds alone collide when
    # two runs start in the same second, and a collision is silent and expensive: run_id
    # seeds question_id, so the second run's questions would inherit the first run's
    # ratings and overwrite its manifest.
    run_id = f"{started.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:6]}"

    return {
        "run_id": run_id,
        "started_at": started.isoformat(),
        "config_hash": config_hash(prompt, schema),
        "prompt_version": PROMPT_VERSION,
        "prompt": prompt,
        "schema": schema,
        "role": params["role"],
        "level": params["level"],
        "subjects": subjects,
        "models": params["models"],
    }


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
        try:
            body, latency_ms = chat_json(model, config["prompt"], config["schema"], api_key)
        except FatalError:
            # A rejected key is not a result about this model. Recording it as one would
            # file five identical "failures" and invite the conclusion that every model
            # is broken.
            raise
        except GenerationError as error:
            rows.append(_failure_row(config, model, str(error)))
            continue

        questions = body.get("questions")
        if not isinstance(questions, list) or not questions:
            rows.append(_failure_row(config, model, f"no questions in response: {str(body)[:120]}"))
            continue

        # A short response is kept, not discarded. A strict schema guarantees a count only
        # when the provider honours it, and the free pool includes providers that do not —
        # but 14 usable questions are 14 usable questions, and throwing them away would
        # both waste the request and hide the shortfall behind a blanket failure. The gap
        # stays visible in the report as questions produced against subjects assigned.
        rows.extend(_question_rows(config, model, questions[: len(config["subjects"])], latency_ms))

    return rows


def _question_rows(config: dict, model: str, questions: list[dict], latency_ms: int) -> list[dict]:
    """One row per question the model returned.

    `subject` is the subject the model tagged, never the slot it landed in. Compliance is
    about *coverage* — did every assigned subject get a question — and a model that answers
    all 15 in a different order has complied. Scoring position instead would report a
    reordered-but-complete set as 0% compliant, which is a false finding about the exact
    thing the column exists to measure. The assigned slot is therefore not recorded; it is
    in the run manifest if a question about ordering ever needs answering.

    `n_subjects` rides along so the report can compute coverage without reopening the
    manifest for every row.
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
            "error": None,
        }
        for index, item in enumerate(questions)
    ]


def _failure_row(config: dict, model: str, error: str) -> dict:
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
        "config_hash": config["config_hash"],
        "prompt_version": config["prompt_version"],
        "role": config["role"],
        "level": config["level"],
        "models": config["models"],
        "subjects": config["subjects"],
        "questions_written": sum(1 for row in rows if not store.failed(row)),
        "failed_models": failed,
        "prompt": config["prompt"],
    }
    store.write_manifest(config["run_id"], summary)
    return summary
