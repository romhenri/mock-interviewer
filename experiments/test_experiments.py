#!/usr/bin/env python
"""Self-checks for the logic that would corrupt results silently if it broke.

    python test_experiments.py

Covers the four things that produce a wrong number rather than an error: config-hash
pooling, latest-rating-wins, subject compliance, and the metrics aggregation. No network.
"""

from __future__ import annotations

import pathlib
import tempfile
import time

import yaml

import metrics
from question_experiments import store
from question_experiments.pipelines.generate import nodes
from question_experiments.pipelines.generate.nodes import (
    _question_rows,
    build_run_config,
    persist_run,
)
from question_experiments import openrouter, prompts
from question_experiments.openrouter import (
    FatalError,
    GenerationError,
    _read_within,
    chat_json,
)
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
    # The answer comes back in the same request as the question. Required, not optional:
    # optional would let a model skip it and still look like a complete result.
    assert schema["items"]["required"] == ["subject", "question", "answer"]


def test_the_model_answer_lands_beside_its_question():
    config = build_run_config(PARAMS)
    rows = _question_rows(config, "m", _answers(SUBJECTS), latency_ms=10)
    assert [row["suggested_answer"] for row in rows] == [f"Because {s}." for s in SUBJECTS]
    # A model that returns a question with no answer is not a failure — the question is
    # still ratable — but the gap must be visible rather than filled in.
    bare = _question_rows(config, "m", [{"subject": "RAG", "question": "RAG: why?"}], latency_ms=10)
    assert bare[0]["suggested_answer"] == ""


def test_duplicate_subjects_are_rejected():
    try:
        build_run_config({**PARAMS, "subjects": ["RAG", "RAG"]})
    except ValueError:
        return
    raise AssertionError("duplicate subjects must fail loudly — they break one-per-subject")


def test_sampled_subjects_are_the_same_for_every_run():
    """`sample` shrinks the assignment to the app's 3 questions. It is seeded because an
    unseeded sample would move config_hash every run, and a latency measured once per
    config is not a measurement."""
    params = {**PARAMS, "subjects": SUBJECTS + ["RNNs", "CNNs"], "sample": 3, "sample_seed": 1}
    first = build_run_config(params)
    assert len(first["subjects"]) == 3
    assert set(first["subjects"]) <= set(params["subjects"])
    assert len(set(first["subjects"])) == 3, "a subject asked twice wastes a slot"
    # Same config, later run: same subjects, same hash, so the rows pool.
    assert build_run_config(params)["config_hash"] == first["config_hash"]
    # A different assignment is a different task and must not pool with it.
    assert build_run_config({**params, "sample_seed": 2})["config_hash"] != first["config_hash"]
    assert build_run_config({**params, "sample": None})["config_hash"] != first["config_hash"]


def test_extra_config_fields_change_the_hash_but_defaults_never_do():
    """The knobs a config can turn (prompt, answer_length, request) all move the hash, or
    two incomparable runs would pool. Taking the defaults must leave the hash exactly where
    it was before those knobs existed, or every traced config breaks the day one is added."""
    base = {"role": "AI Engineer", "level": "Mid", "subjects": SUBJECTS}
    _, _, hashed = prompts.render(base)
    assert hashed == config_hash(questions_prompt("AI Engineer", "Mid", SUBJECTS), questions_schema(SUBJECTS))
    # Unset, empty and explicitly-default are all the same task.
    for quiet in ({"request": None}, {"request": {}}, {"answer_length": prompts.ANSWER_LENGTH}):
        assert prompts.render({**base, **quiet})[2] == hashed

    assert prompts.render({**base, "timeout": None, "retry": None})[2] == hashed
    # `retry: false` is a choice, not an absence, so it must reach the hash. A truth test
    # here would drop exactly the setting the field exists for.
    for louder in ({"request": {"temperature": 0.2}}, {"answer_length": "one sentence"},
                   {"timeout": 60}, {"retry": False}, {"retry_pause": 0},
                   {"prompt": "Ask $count $level questions about:\n$subjects"}):
        assert prompts.render({**base, **louder})[2] != hashed, louder

    # A custom template is substituted, not formatted, so braces in prose stay put.
    prompt, _, _ = prompts.render({**base, "prompt": "{json} for $count $role subjects:\n$subjects"})
    assert prompt.startswith("{json} for 3 AI Engineer subjects:\n1. RAG")
    # A typo in a placeholder fails here rather than being sent to five models.
    try:
        prompts.render({**base, "prompt": "$levl"})
    except KeyError:
        pass
    else:
        raise AssertionError("an unknown placeholder must fail before the run starts")


def test_the_client_owns_some_request_fields():
    """`model` is the pinning this whole project rests on. A config that could override it
    would file one model's questions under another's name, silently."""
    try:
        chat_json("m", "p", questions_schema(SUBJECTS), "key", {"model": "other", "temperature": 0})
    except FatalError as error:
        assert "model" in str(error)
    else:
        raise AssertionError("reserved request fields must be refused before any request")

    # A timeout that can only produce timeouts is a config error, so it aborts the run
    # rather than filing five identical failures against five innocent models.
    for broken in (0, -30, "30s", True):
        try:
            chat_json("m", "p", questions_schema(SUBJECTS), "key", None, broken)
        except FatalError as error:
            assert "positive number" in str(error), broken
        else:
            raise AssertionError(f"timeout {broken!r} must be refused")

    for field, broken in (("retry", "yes"), ("retry", 1), ("retry_pause", -5), ("retry_pause", "20s")):
        try:
            chat_json("m", "p", questions_schema(SUBJECTS), "key", **{field: broken})
        except FatalError as error:
            assert field in str(error), (field, broken)
        else:
            raise AssertionError(f"{field}={broken!r} must be refused")


def test_retry_can_be_turned_off():
    """`retry: false` is what makes a failure-mode run take seconds instead of two minutes,
    so it has to actually skip the attempt rather than only skip the pause."""
    calls = []

    def fail(payload, api_key, timeout):
        calls.append(timeout)
        raise GenerationError("nope")

    original, openrouter._attempt = openrouter._attempt, fail
    try:
        for retry, expected in ((None, 2), (True, 2), (False, 1)):
            calls.clear()
            try:
                # No pause, so the retrying cases do not sleep through the test.
                chat_json("m", "p", questions_schema(SUBJECTS), "key",
                          retry=retry, retry_pause=0, timeout=5)
            except GenerationError:
                pass
            assert len(calls) == expected, f"retry={retry} should make {expected} attempt(s)"
            assert calls == [5] * expected, "every attempt gets the full timeout, not a share"
    finally:
        openrouter._attempt = original


def test_a_named_config_replaces_the_parameters_it_does_not_merge():
    """A traced config must render the same prompt years later, so it inherits nothing.
    Merging would let an edit to conf/base move a hash the file claims to reproduce."""
    with tempfile.TemporaryDirectory() as folder:
        original, store.CONFIGS = store.CONFIGS, pathlib.Path(folder)
        try:
            (store.CONFIGS / "traced.yml").write_text(
                yaml.safe_dump({"role": "AI Engineer", "level": "Rookie",
                                "subjects": SUBJECTS, "models": ["a"]}), encoding="utf-8"
            )
            config = build_run_config({**PARAMS, "config": "traced", "level": "Senior"})
            assert config["level"] == "Rookie", "the file wins over the parameters it replaces"
            assert config["models"] == ["a"]
            assert config["config"] == "traced", "the manifest must record which file ran"
            # A name that does not exist fails before any request is spent.
            try:
                build_run_config({**PARAMS, "config": "missing"})
            except ValueError:
                pass
            else:
                raise AssertionError("an unknown config name must fail loudly")
        finally:
            store.CONFIGS = original


def test_a_body_that_never_ends_is_abandoned():
    """The socket timeout cannot catch this: a connection padded to keep it alive is never
    silent, which is how one request ran 466s under a 120s socket timeout."""

    class Trickle:
        """Sends forever, a few bytes at a time, like a padded connection or a model looping
        on one token. Small chunks are the point: this is read through `read1`, which returns
        what arrived rather than blocking for a full buffer, so the deadline is checked per
        packet. Blocking for a full buffer is how a 2s budget once took 81.6s."""

        def read1(self, _n):
            time.sleep(0.01)
            return b"xx"

    started = time.monotonic()
    try:
        _read_within(Trickle(), 0.1)
    except GenerationError as error:
        assert "gave up" in str(error)
        assert time.monotonic() - started < 1, "the deadline must bind, not merely be noticed"
    else:
        raise AssertionError("a body that never ends must be cut off, not waited out")

    # A body that finishes inside the budget is returned whole, deadline or not.
    class Done:
        def __init__(self):
            self.left = [b"{", b"}"]

        def read1(self, _n):
            return self.left.pop(0) if self.left else b""

    assert _read_within(Done(), 5) == b"{}"


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


def test_mlflow_metrics_agree_with_the_report():
    """The per-request metrics logged at run time must mean what the same-named columns in
    metrics.py mean, or the UI and the report disagree about the same request."""
    config = build_run_config(PARAMS)
    usage = {"prompt_tokens": 300, "completion_tokens": 200, "cost_usd": 0.002}
    rows = _question_rows(config, config["models"][0], _answers(["RAG", "Attention"]),
                          latency_ms=100, usage=usage)

    logged = nodes._request_metrics(rows, config)
    assert logged["covered"] == metrics._coverage(rows) == 2 / 3
    assert logged["latency_ms"] == 100
    assert logged["cost_usd"] == 0.002, "the request's cost, not the sum over its rows"
    assert logged["failed"] == 0
    # 200 completion tokens in 100ms. Latency alone ranks a terser model faster than a
    # quicker one, and this is the column that separates them.
    assert logged["tokens_per_sec"] == 2000

    failed = nodes._request_metrics([nodes._failure_row(config, config["models"][1], "429")], config)
    assert failed["failed"] == 1
    assert failed["questions_written"] == 0
    assert "latency_ms" not in failed, "a failed request has no latency"
    assert "covered" not in failed, "nor coverage — it produced nothing to cover with"


def test_a_request_is_its_own_mlflow_run():
    """Model is a param on the request's run, never a suffix on the metric name: a value in
    a column groups and averages, a value baked into `latency_ms.<model>` does not."""
    logged = nodes._request_metrics(
        _question_rows(build_run_config(PARAMS), "a", _answers(["RAG"]), latency_ms=100), PARAMS
    )
    assert not [key for key in logged if "." in key], f"flattened metric names are back: {logged}"


def test_cost_is_per_request_not_per_question():
    """The request's cost is repeated on every row it produced, so anything that sums the
    column bills each question separately. Two questions from one request cost one request."""
    config = build_run_config(PARAMS)
    usage = {"prompt_tokens": 300, "completion_tokens": 200, "cost_usd": 0.002}
    rows = _question_rows(config, "a", _answers(["RAG", "Attention"]), latency_ms=100, usage=usage)
    rows += _question_rows(config, "b", _answers(["RAG"]), latency_ms=100, usage=usage)

    totals = nodes._run_totals(rows)
    assert totals == {"cost_usd": 0.004, "tokens": 1000}, "two requests, five rows"

    # A model whose provider reported nothing is unknown, not free — and must not crash
    # the totals of the models that did report.
    rows += _question_rows(config, "c", _answers(["RAG"]), latency_ms=100)
    assert nodes._run_totals(rows)["cost_usd"] == 0.004

    # metrics.py reads the same rows and must reach the same bill.
    assert metrics.summarise(rows, {})[0]["cost_usd"] == 0.002


def test_usage_is_read_from_the_body_and_cannot_be_overridden():
    """`usage.include` is what puts `cost` in the body at all, so a config that set it
    would silently empty the cost column."""
    assert openrouter._usage({"usage": {"prompt_tokens": 7, "completion_tokens": 3, "cost": 0.01}}) == {
        "prompt_tokens": 7,
        "completion_tokens": 3,
        "cost_usd": 0.01,
    }
    # A provider that reports nothing gives None, never 0: a free request and an unreported
    # one are different findings.
    assert openrouter._usage({}) == openrouter.NO_USAGE

    try:
        chat_json("m", "p", questions_schema(SUBJECTS), "key", {"usage": {"include": False}})
    except FatalError as error:
        assert "usage" in str(error)
    else:
        raise AssertionError("usage is the client's, not the config's")


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
        {**_row("x", "broken"), "error": "HTTP 429", "latency_ms": None},
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


def test_metrics_read_rows_written_before_the_failed_key_was_dropped():
    """`questions.jsonl` is append-only, so rows written by an older schema stay in the file
    forever. Failure is defined by `error`, which those rows already carry — the stale
    `failed` and `slot_subject` keys ride along unread rather than needing a migration."""
    legacy_ok = {**_row("q1", "m"), "slot_subject": "RAG", "failed": False}
    legacy_bad = {**_row("x", "m"), "slot_subject": None, "failed": True, "error": "HTTP 429"}

    summary = metrics.summarise([legacy_ok, legacy_bad], {("q1", "ana"): 4})[0]
    assert summary["n_questions"] == 1, "the legacy failure row must not count as a question"
    assert summary["failure_rate"] == 1.0


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
        persist_run([_row("q1", "a"), {**_row("x", "b"), "error": "HTTP 429"}], config)
        persist_run([_row("q2", "a")], build_run_config(PARAMS))

        assert len(store.read(store.QUESTIONS)) == 3, "second run must append, not overwrite"

        manifest = yaml.safe_load((store.RUNS / config["run_id"] / "manifest.yml").read_text())
        assert manifest["config_hash"] == config["config_hash"]
        assert manifest["failed_models"] == ["b"]
        assert manifest["questions_written"] == 1
        # The prompt is stored in full so a run stays interpretable after prompts.py moves on.
        assert manifest["prompt"] == config["prompt"]


def _answers(subjects: list[str]) -> list[dict]:
    return [{"subject": s, "question": f"{s}: why?", "answer": f"Because {s}."} for s in subjects]


def _row(question_id: str, model: str, subject: str = "RAG", latency_ms: int = 100) -> dict:
    return {
        "question_id": question_id,
        "run_id": "r1",
        "config_hash": "abc",
        "model": model,
        "subject": subject,
        "n_subjects": 3,
        "index": 0,
        "text": "RAG: why chunk?",
        "suggested_answer": "Chunks keep retrieval units small enough to match a query.",
        "latency_ms": latency_ms,
        "error": None,
    }


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"\n{len(tests)} passed")
