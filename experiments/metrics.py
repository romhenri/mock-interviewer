#!/usr/bin/env python
"""Average question quality per model, from every rated run.

Pools across runs only within a `config_hash`. Two runs share a hash when they rendered a
byte-identical prompt — same role, level, subject list and wording. Change any of those and
the ratings measure a different task, so they get their own table rather than being averaged
into a number that means nothing.

    python metrics.py
    python metrics.py --config-hash a1b2c3d4e5f6
"""

from __future__ import annotations

import argparse
import statistics
import sys
from collections import defaultdict

from question_experiments import store


def summarise(questions: list[dict], ratings: dict[tuple[str, str], int]) -> list[dict]:
    """One row per model, for questions sharing a single config_hash."""
    # Every rater's rating counts as a data point, so a second rater widens the sample
    # rather than overwriting the first.
    by_question: dict[str, list[int]] = defaultdict(list)
    for (question_id, _rater), rating in ratings.items():
        by_question[question_id].append(rating)

    by_model: dict[str, list[dict]] = defaultdict(list)
    for row in questions:
        by_model[row["model"]].append(row)

    summary = []
    for model, rows in sorted(by_model.items()):
        produced = [row for row in rows if not store.failed(row)]
        scores = [rating for row in produced for rating in by_question[row["question_id"]]]

        # A request either produces the whole set or fails, so requests are counted as
        # (run_id, model) pairs — counting rows would let one model's 15 questions
        # outweigh another's single failure.
        requests = {row["run_id"] for row in rows}
        failed_requests = {row["run_id"] for row in rows if store.failed(row)}

        summary.append(
            {
                "model": model,
                "mean_quality": statistics.fmean(scores) if scores else None,
                "stdev": statistics.stdev(scores) if len(scores) > 1 else None,
                "n_rated": len(scores),
                "n_questions": len(produced),
                "coverage": _coverage(produced),
                "failure_rate": len(failed_requests) / len(requests) if requests else None,
                "mean_latency_ms": (
                    statistics.fmean([row["latency_ms"] for row in produced if row["latency_ms"] is not None])
                    if any(row["latency_ms"] is not None for row in produced)
                    else None
                ),
                "runs": len(requests),
            }
        )

    # Best first, but unrated models sort last rather than crashing the comparison.
    return sorted(summary, key=lambda row: (row["mean_quality"] is None, -(row["mean_quality"] or 0)))


def _coverage(produced: list[dict]) -> float | None:
    """Share of assigned subjects that actually got a question, averaged over runs.

    Distinct subjects, not row count: a model that writes three questions about RAG and
    skips Diffusion Models has produced a full set of rows while covering less of the
    assignment, and that gap is the finding. Order is not compliance — the enum in the
    schema already bounds what a subject can be, so distinct tags are coverage.
    """
    if not produced:
        return None

    per_run = defaultdict(set)
    sizes = {}
    for row in produced:
        per_run[row["run_id"]].add(row["subject"])
        sizes[row["run_id"]] = row["n_subjects"]

    return statistics.fmean(len(subjects) / sizes[run] for run, subjects in per_run.items())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-hash", help="report only this config")
    args = parser.parse_args()

    questions = store.read(store.QUESTIONS)
    if not questions:
        print("No runs yet. Run `kedro run` first.")
        return 1

    ratings = store.latest_ratings(store.read(store.RATINGS))

    groups: dict[str, list[dict]] = defaultdict(list)
    for row in questions:
        groups[row["config_hash"]].append(row)

    if args.config_hash:
        groups = {key: rows for key, rows in groups.items() if key == args.config_hash}
        if not groups:
            print(f"No questions with config_hash {args.config_hash}.")
            return 1

    for config_hash, rows in groups.items():
        runs = sorted({row["run_id"] for row in rows})
        print(f"\nconfig {config_hash} — {len(runs)} run(s): {', '.join(runs)}")
        if len(groups) > 1:
            print("  (a separate table per config: different prompts are not comparable)")
        _print_table(summarise(rows, ratings))

    if not ratings:
        print("\nNothing rated yet — run `python rate.py`. Only the objective columns are filled in.")
    return 0


def _print_table(summary: list[dict]) -> None:
    header = f"  {'model':<42} {'quality':>8} {'stdev':>7} {'rated':>6} {'covered':>8} {'fail':>6} {'latency':>9}"
    print(header)
    print("  " + "-" * (len(header) - 2))
    for row in summary:
        print(
            f"  {row['model']:<42} "
            f"{_or_dash(row['mean_quality'], '{:.2f}'):>8} "
            f"{_or_dash(row['stdev'], '{:.2f}'):>7} "
            f"{row['n_rated']:>3}/{row['n_questions']:<2} "
            f"{_or_dash(row['coverage'], '{:.0%}'):>8} "
            f"{_or_dash(row['failure_rate'], '{:.0%}'):>6} "
            f"{_or_dash(row['mean_latency_ms'], '{:.0f}ms'):>9}"
        )


def _or_dash(value: float | None, fmt: str) -> str:
    return "—" if value is None else fmt.format(value)


if __name__ == "__main__":
    sys.exit(main())
