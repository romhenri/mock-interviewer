#!/usr/bin/env python
"""Average question quality per model, from every rated run.

Pools across runs only within a `config_hash`. Two runs share a hash when they rendered a
byte-identical prompt — same role, level, subject list and wording. Change any of those and
the ratings measure a different task, so they get their own table rather than being averaged
into a number that means nothing.

    python metrics.py
    python metrics.py --config-hash a1b2c3d4e5f6
    python metrics.py --mlflow          # also write the ratings back onto the MLflow runs
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

        # Cost belongs to the request, and the request's cost is repeated on every row it
        # produced — so one row per run is counted, not one per question. Rows written
        # before the column existed have no cost, which is unknown rather than free: they
        # are left out of the sum, and a model whose runs all predate it reports nothing.
        per_request = {}
        for row in rows:
            per_request.setdefault(row["run_id"], row)
        costs = [row["cost_usd"] for row in per_request.values() if row.get("cost_usd") is not None]

        summary.append(
            {
                "model": model,
                "mean_quality": statistics.fmean(scores) if scores else None,
                "stdev": statistics.stdev(scores) if len(scores) > 1 else None,
                "n_rated": len(scores),
                "n_questions": len(produced),
                "coverage": _coverage(produced),
                "failure_rate": len(failed_requests) / len(requests) if requests else None,
                "cost_usd": sum(costs) if costs else None,
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


def to_mlflow(questions: list[dict], ratings: dict[tuple[str, str], int]) -> None:
    """Logs each request's quality onto the MLflow run the pipeline opened for it.

    A rating arrives hours or days after the request that produced the question, so quality
    cannot be logged where latency and coverage are. This closes that loop: the existing run
    is reopened by its (`run_id`, `model`) params and the quality metrics are added to it,
    which is what makes the MLflow table complete — one row per request, objective columns
    beside rated ones.

    Per request rather than pooled per config_hash, because an MLflow run *is* one request.
    The pooled view is the table this script prints; averaging four requests into each of
    them would put the same number on four rows and call it four measurements.

    Re-running appends to each metric's history instead of replacing it, so a partly-rated
    run charts its quality settling as more ratings come in.
    """
    import mlflow  # imported here: the report itself must keep working without mlflow installed
    import yaml

    # Read rather than repeated, so the ui, the pipeline and this script cannot end up
    # pointing at three different databases. The path inside the uri is relative to the
    # project root — kedro is always run from there, this script is not, so it is resolved
    # here rather than left to the working directory.
    config = yaml.safe_load((store.ROOT / "conf" / "base" / "mlflow.yml").read_text())
    uri = config["server"]["mlflow_tracking_uri"]
    mlflow.set_tracking_uri(uri.replace("sqlite:///", f"sqlite:///{store.ROOT}/", 1))
    mlflow.set_experiment(config["tracking"]["experiment"]["name"])

    by_run: dict[str, list[dict]] = defaultdict(list)
    for row in questions:
        by_run[row["run_id"]].append(row)

    # One search, then a dict lookup. A query per (run, model) would refetch the same table
    # once for every model that produced a question in it.
    by_request = {
        (run.data.params.get("run_id"), run.data.params.get("model")): run.info.run_id
        for run in mlflow.search_runs(output_format="list")
    }

    for run_id, rows in sorted(by_run.items()):
        logged = 0
        for row in summarise(rows, ratings):
            if not row["n_rated"]:
                continue

            target = by_request.get((run_id, row["model"]))
            if target is None:
                # Requests from before each one became its own mlflow run, and runs whose
                # mlruns/ was deleted. Their questions and ratings are intact on disk; only
                # the UI row is missing.
                continue

            with mlflow.start_run(run_id=target):
                mlflow.log_metrics({"quality": row["mean_quality"], "rated": row["n_rated"]})
            logged += 1

        print(f"  logged {run_id}: {logged} request(s)" if logged else f"  skip {run_id}: no request run")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-hash", help="report only this config")
    parser.add_argument("--mlflow", action="store_true", help="log quality onto the MLflow runs")
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
        summary = summarise(rows, ratings)
        _print_table(summary)
        spent = [row["cost_usd"] for row in summary if row["cost_usd"] is not None]
        if spent:
            print(f"  total spent: ${sum(spent):.4f} over {len(runs)} run(s)")

    if not ratings:
        print("\nNothing rated yet — run `python rate.py`. Only the objective columns are filled in.")
    elif args.mlflow:
        print("\nmlflow:")
        to_mlflow([row for rows in groups.values() for row in rows], ratings)
    return 0


def _print_table(summary: list[dict]) -> None:
    header = (f"  {'model':<42} {'quality':>8} {'stdev':>7} {'rated':>6} {'covered':>8} "
              f"{'fail':>6} {'latency':>9} {'cost':>9}")
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
            f"{_or_dash(row['mean_latency_ms'], '{:.0f}ms'):>9} "
            f"{_or_dash(row['cost_usd'], '${:.4f}'):>9}"
        )


def _or_dash(value: float | None, fmt: str) -> str:
    return "—" if value is None else fmt.format(value)


if __name__ == "__main__":
    sys.exit(main())
