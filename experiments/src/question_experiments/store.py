"""Flat, append-only storage. Shared by the pipeline, the rater and the metrics script.

Two files, both append-only, both one JSON object per line:

    data/questions.jsonl   what the models produced
    data/ratings.jsonl     what the human thought of it

They are separate on purpose. Generation is repeatable and cheap; a human rating is neither.
Keeping them apart means re-running the pipeline can never overwrite hand-collected work.

Append-only JSONL rather than Kedro's versioned datasets: "compare any run with any future
run" is a group-by over one file here, and a walk over a tree of timestamped directories
there. The dashboard this feeds later reads two files.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
QUESTIONS = DATA / "questions.jsonl"
RATINGS = DATA / "ratings.jsonl"
RUNS = DATA / "runs"


def question_id(run_id: str, model: str, index: int) -> str:
    """Stable across re-reads so ratings survive anything but a regeneration."""
    return hashlib.sha256(f"{run_id}|{model}|{index}".encode()).hexdigest()[:12]


def append(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def read(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_manifest(run_id: str, manifest: dict) -> Path:
    path = RUNS / run_id / "manifest.yml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True, default_flow_style=False),
        encoding="utf-8",
    )
    return path


def latest_ratings(rows: list[dict]) -> dict[tuple[str, str], int]:
    """Collapses the append-only rating log to one rating per (question, rater).

    The file keeps every rating ever given; a later one supersedes an earlier one rather
    than replacing it in place, so the history stays intact and a re-rate is not a
    destructive edit. Later wins by file order, which is append order.
    """
    latest: dict[tuple[str, str], int] = {}
    for row in rows:
        latest[(row["question_id"], row["rater"])] = row["rating"]
    return latest
