#!/usr/bin/env python
"""Interactive human rating, 1–5, one question at a time.

Outside the Kedro graph on purpose: a node that blocks on keypresses makes `kedro run`
un-runnable unattended.

Blind by construction. Questions from every model are pooled and shuffled, and the model
that wrote one is never printed — you picked the models, so seeing "nemotron-120b" above a
question is enough to move a 3 to a 4. The model is joined back in by metrics.py.

Every rating is appended the moment you press the key, and the script resumes from whatever
is unrated, so quitting at question 40 of 75 costs nothing.

    python rate.py                    # everything unrated, newest config first
    python rate.py --run 20260812T2312Z
    python rate.py --rater alice
"""

from __future__ import annotations

import argparse
import datetime as dt
import getpass
import random
import sys

from question_experiments import store

SCALE = {
    "1": "unusable",
    "2": "weak",
    "3": "usable",
    "4": "good",
    "5": "would ask this",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", help="rate only this run_id")
    parser.add_argument("--config-hash", help="rate only questions from this config")
    parser.add_argument("--rater", default=getpass.getuser(), help="who is rating")
    parser.add_argument("--seed", type=int, help="fix the shuffle, for a reproducible order")
    args = parser.parse_args()

    questions = [row for row in store.read(store.QUESTIONS) if not store.failed(row)]
    if args.run:
        questions = [row for row in questions if row["run_id"] == args.run]
    if args.config_hash:
        questions = [row for row in questions if row["config_hash"] == args.config_hash]

    if not questions:
        print("No questions to rate. Run `kedro run` first.")
        return 1

    rated = store.latest_ratings(store.read(store.RATINGS))
    pending = [row for row in questions if (row["question_id"], args.rater) not in rated]

    done = len(questions) - len(pending)
    if not pending:
        print(f"All {len(questions)} questions already rated by {args.rater}.")
        return 0

    random.Random(args.seed).shuffle(pending)

    print(f"Rating as {args.rater}. {len(pending)} to go, {done} already done.")
    print("  " + "   ".join(f"{key} {label}" for key, label in SCALE.items()))
    print("  s skip   q save and quit\n")

    for position, row in enumerate(pending, start=1):
        print(f"[{position}/{len(pending)}]  subject: {row['subject']}")
        print(f"  {row['text']}\n")
        # The model's own answer, indented and labelled so it stays evidence rather than
        # the thing being rated. It is what makes a question judgeable: one that cannot be
        # answered in the budget, or whose own answer only restates it, is a bad question.
        # Older rows predate the field and print nothing.
        if row.get("suggested_answer"):
            print(f"  would accept: {row['suggested_answer']}\n")

        choice = _ask()
        if choice == "q":
            print(f"\nStopped. {position - 1} rated this session — run again to continue.")
            return 0
        if choice == "s":
            print()
            continue

        store.append(
            store.RATINGS,
            [
                {
                    "question_id": row["question_id"],
                    "rating": int(choice),
                    "rater": args.rater,
                    "ts": dt.datetime.now(dt.timezone.utc).isoformat(),
                }
            ],
        )
        print()

    print(f"Done — {len(pending)} rated. Now: python metrics.py")
    return 0


def _ask() -> str:
    while True:
        try:
            choice = input("  rating> ").strip().lower()
        except EOFError:
            return "q"
        if choice in SCALE or choice in ("s", "q"):
            return choice
        print("  1-5, s to skip, q to quit.")


if __name__ == "__main__":
    sys.exit(main())
