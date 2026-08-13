#!/usr/bin/env python
"""Self-checks for the logic that would corrupt results silently if it broke.

    python test_experiments.py

Covers the four things that produce a wrong number rather than an error: config-hash
pooling, latest-rating-wins, subject compliance, and the metrics aggregation. No network.
"""

from __future__ import annotations

import pathlib
import tempfile

import yaml

import metrics
from question_experiments import store
from question_experiments.pipelines.generate import nodes
from question_experiments.pipelines.generate.nodes import (
    _question_rows,
    build_run_config,
    persist_run,
)
from question_experiments.openrouter import FatalError, GenerationError
from question_experiments.prompts import config_hash, questions_prompt, questions_schema

SUBJECTS = ["RAG", "Attention", "Tokenization"]
PARAMS = {"role": "AI Engineer", "level": "Mid", "subjects": SUBJECTS, "models": ["a", "b"]}


def test_config_hash_tracks_the_task():
    def hash_for(role="AI Engineer", level="Mid", subjects=SUBJECTS):
        return config_hash(questions_prompt(role, level, subjects), questions_schema(subjects))

    base = hash_for()
    assert base == hash_for(), "identical configs must pool together"
    # Anything that changes the task must move the hash, or metrics.py pools ratings that
    # measured different things.
    assert base != hash_for(level="Senior")
    assert base != hash_for(role="Back-end Engineer")
    assert base != hash_for(subjects=SUBJECTS[::-1])
    assert base != hash_for(subjects=SUBJECTS[:2])
    # The schema constrains the count and the permitted subjects, and can be loosened
    # without touching a word of the prompt — so it has to be in the hash too.
    loosened = dict(questions_schema(SUBJECTS))
    loosened["schema"]["properties"]["questions"]["minItems"] = 1
    assert base != config_hash(questions_prompt("AI Engineer", "Mid", SUBJECTS), loosened)


def test_schema_pins_count_and_subjects():
    schema = questions_schema(SUBJECTS)["schema"]["properties"]["questions"]
    assert schema["minItems"] == schema["maxItems"] == len(SUBJECTS)
    assert schema["items"]["properties"]["subject"]["enum"] == SUBJECTS


def test_duplicate_subjects_are_rejected():
    try:
        build_run_config({**PARAMS, "subjects": ["RAG", "RAG"]})
    except ValueError:
        return
    raise AssertionError("duplicate subjects must fail loudly — they break one-per-subject")


def test_a_rejected_key_is_not_a_result_about_the_model():
    """A bad key fails identically on every model. Recorded as five model failures it reads
    as "every model is broken", so it must abort the run instead."""
    assert issubclass(FatalError, GenerationError), "nodes catch GenerationError broadly"

    config = build_run_config(PARAMS)
    original = nodes.chat_json
    nodes.chat_json = _raise(FatalError("OpenRouter rejected the API key (HTTP 401)"))
    nodes.load_api_key = lambda: "stub"
    try:
        nodes.generate_questions(config)
    except FatalError:
        return
    finally:
        nodes.chat_json = original
    raise AssertionError("a rejected key must abort, not produce a failure row per model")


def _raise(error: Exception):
    def fail(*_args, **_kwargs):
        raise error

    return fail


def test_run_ids_are_unique_within_a_second():
    """run_id seeds question_id, so a collision silently hands one run's ratings to
    another and overwrites its manifest. Two runs started back to back must differ."""
    ids = {build_run_config(PARAMS)["run_id"] for _ in range(50)}
    assert len(ids) == 50


def test_question_ids_are_unique_and_stable():
    config = build_run_config(PARAMS)
    ids = [
        store.question_id(config["run_id"], model, index)
        for model in PARAMS["models"]
        for index in range(len(SUBJECTS))
    ]
    assert len(set(ids)) == len(ids), "a collision would merge two models' ratings"
    assert ids[0] == store.question_id(config["run_id"], "a", 0), "ids must be reproducible"


def test_coverage_counts_subjects_not_order():
    """A complete set in a different order is compliant; a set that skips a subject is not.
    Scoring by position would report the first as 0% and hide the second."""
    reordered = _answers(["Tokenization", "RAG", "Attention"])
    assert metrics._coverage(_question_rows(build_run_config(PARAMS), "a", reordered, 100)) == 1.0

    # Skipped Attention, answered Tokenization twice.
    skipped = _answers(["RAG", "Tokenization", "Tokenization"])
    assert metrics._coverage(_question_rows(build_run_config(PARAMS), "a", skipped, 100)) == 2 / 3


def test_short_responses_are_kept_not_discarded():
    """14 usable questions are 14 usable questions. Discarding them would waste the request
    and hide the shortfall behind a blanket failure."""
    config = build_run_config(PARAMS)
    rows = _question_rows(config, "a", _answers(["RAG", "Attention"]), latency_ms=100)
    assert len(rows) == 2
    assert metrics._coverage(rows) == 2 / 3, "the gap must stay visible, not vanish"


def test_latest_rating_wins_per_rater():
    rows = [
        {"question_id": "q1", "rating": 2, "rater": "ana"},
        {"question_id": "q1", "rating": 5, "rater": "ana"},  # re-rated
        {"question_id": "q1", "rating": 3, "rater": "bo"},
    ]
    latest = store.latest_ratings(rows)
    assert latest == {("q1", "ana"): 5, ("q1", "bo"): 3}


def test_metrics_aggregate_per_model():
    questions = [
        _row("q1", "fast", subject="RAG", latency_ms=100),
        _row("q2", "fast", subject="Attention", latency_ms=100),
        _row("q3", "slow", subject="RAG", latency_ms=900),
        {**_row("x", "broken"), "failed": True, "latency_ms": None},
    ]
    ratings = {("q1", "ana"): 5, ("q2", "ana"): 3, ("q3", "ana"): 2}

    summary = {row["model"]: row for row in metrics.summarise(questions, ratings)}

    assert summary["fast"]["mean_quality"] == 4.0
    assert summary["fast"]["n_rated"] == 2
    assert summary["fast"]["coverage"] == 2 / 3, "2 of 3 assigned subjects covered"
    assert summary["fast"]["failure_rate"] == 0.0
    assert summary["slow"]["mean_latency_ms"] == 900
    # A model that only ever failed has no quality, but its failure rate is the finding.
    assert summary["broken"]["mean_quality"] is None
    assert summary["broken"]["failure_rate"] == 1.0
    # Ranked best-first, with the unrated model last rather than crashing the sort.
    assert [row["model"] for row in metrics.summarise(questions, ratings)] == ["fast", "slow", "broken"]


def test_metrics_ignore_unrated_questions_without_dropping_them():
    questions = [_row("q1", "m"), _row("q2", "m")]
    summary = metrics.summarise(questions, {("q1", "ana"): 4})[0]
    assert summary["mean_quality"] == 4.0
    assert (summary["n_rated"], summary["n_questions"]) == (1, 2), "half-rated must be visible"


def test_persist_appends_and_writes_a_readable_manifest():
    """Appending must never truncate — a run that clobbered the previous one would delete
    exactly the history this experiment exists to accumulate."""
    with tempfile.TemporaryDirectory() as tmp:
        store.QUESTIONS = pathlib.Path(tmp) / "questions.jsonl"
        store.RUNS = pathlib.Path(tmp) / "runs"

        config = build_run_config(PARAMS)
        persist_run([_row("q1", "a"), {**_row("x", "b"), "failed": True}], config)
        persist_run([_row("q2", "a")], build_run_config(PARAMS))

        assert len(store.read(store.QUESTIONS)) == 3, "second run must append, not overwrite"

        manifest = yaml.safe_load((store.RUNS / config["run_id"] / "manifest.yml").read_text())
        assert manifest["config_hash"] == config["config_hash"]
        assert manifest["failed_models"] == ["b"]
        assert manifest["questions_written"] == 1
        # The prompt is stored in full so a run stays interpretable after prompts.py moves on.
        assert manifest["prompt"] == config["prompt"]


def _answers(subjects: list[str]) -> list[dict]:
    return [{"subject": s, "question": f"{s}: why?"} for s in subjects]


def _row(question_id: str, model: str, subject: str = "RAG", latency_ms: int = 100) -> dict:
    return {
        "question_id": question_id,
        "run_id": "r1",
        "config_hash": "abc",
        "model": model,
        "subject": subject,
        "slot_subject": "RAG",
        "n_subjects": 3,
        "index": 0,
        "text": "RAG: why chunk?",
        "latency_ms": latency_ms,
        "failed": False,
        "error": None,
    }


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"\n{len(tests)} passed")
