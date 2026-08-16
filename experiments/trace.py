#!/usr/bin/env python
"""Writes one `conf/experiments/<name>.yml` per config that has already been run.

    python trace.py            # write the missing ones
    python trace.py --check    # verify existing ones still render their hash, write nothing

Every run already leaves `data/runs/<run_id>/manifest.yml`, which records what it measured.
What it does not give you is a way to run it *again*: the manifest is a record, not an input,
and reconstructing the parameters from it by hand is how a "same" run ends up not being one.
This turns each distinct `config_hash` on disk into a config file that reproduces it exactly.

Reproduction is verified, not assumed: a generated file is re-read, its prompt and schema are
rendered, and the resulting hash is compared with the hash the run recorded. A file that does
not reproduce is not written.
"""

from __future__ import annotations

import argparse
import re
import sys

import yaml

from question_experiments import store
from question_experiments.prompts import CLIENT_SETTINGS, PROMPT_VERSION, is_set, render

#: Always written, because every config needs them.
FIELDS = ("role", "level", "subjects", "models")

#: Written only when the run used them, so a config that took the defaults stays four keys
#: long. Left of the arrow is the manifest's name, right is the config file's: the manifest
#: separates the template from the rendered prompt, a config file only has the template.
OPTIONAL = {
    "prompt_template": "prompt",
    "answer_length": "answer_length",
    **{key: key for key in CLIENT_SETTINGS},
}


def manifests() -> list[dict]:
    """Every run on disk, oldest first, so the first run to use a config gets to name it."""
    return sorted(
        (yaml.safe_load(path.read_text(encoding="utf-8")) for path in store.RUNS.glob("*/manifest.yml")),
        key=lambda m: m["run_id"],
    )


def by_config(runs: list[dict]) -> dict[str, dict]:
    """One entry per config_hash, holding the first run that used it and every run id."""
    configs: dict[str, dict] = {}
    for run in runs:
        entry = configs.setdefault(run["config_hash"], {"first": run, "runs": []})
        entry["runs"].append(run["run_id"])
    return configs


def name_for(run: dict, taken: dict[str, str]) -> str:
    """`ai-engineer-rookie-3`: what the run asked, at a glance, in a filename.

    The subject count is in the name because it is the difference a reader most needs to
    see — a 15-subject survey and the 3-question run the app makes are different experiments
    that otherwise read identically. A collision only happens between two configs that agree
    on all three, which means they differ in *which* subjects, so the hash decides.
    """
    # A run launched from a config file already has a name, and it is the one a human chose.
    # Deriving a second one would write a duplicate file for a config that is already traced.
    if run.get("config"):
        return run["config"]

    slug = "-".join(re.findall(r"[a-z0-9]+", f"{run['role']} {run['level']}".lower()))
    name = f"{slug}-{len(run['subjects'])}"
    if taken.get(name, run["config_hash"]) != run["config_hash"]:
        name = f"{name}-{run['config_hash'][:6]}"
    return name


def as_file(run: dict, runs: list[str], name: str) -> str:
    """The file: a header saying where it came from, then the parameters and nothing else."""
    header = [
        f"# Traced from {runs[0]} by trace.py. Reproduces config_hash {run['config_hash']}.",
        f"# Prompt {run['prompt_version']}. Runs so far: {', '.join(runs)}.",
        "",
    ]
    body = yaml.safe_dump(
        as_config(run),
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
    )
    return "\n".join(header) + body


def as_config(run: dict) -> dict:
    """The manifest, reduced to the keys a config file is made of."""
    config = {field: run[field] for field in FIELDS}
    config.update(
        {name: run[key] for key, name in OPTIONAL.items() if is_set(run.get(key))}
    )
    return config


def reproduces(run: dict, expected: str) -> bool:
    """Renders a config the way the pipeline would and compares the hash it produces.

    Takes a manifest or a config file: `as_config` flattens the difference, and `render` is
    the same function the pipeline calls, so this cannot drift from what a run would do.
    """
    return render(as_config(run) if "prompt_template" in run else run)[2] == expected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify, write nothing")
    args = parser.parse_args()

    runs = manifests()
    if not runs:
        print("No runs on disk yet, so there is nothing to trace. Run `kedro run` first.")
        return 1

    store.CONFIGS.mkdir(parents=True, exist_ok=True)

    # A config the current code cannot re-render gets no file and does not reserve a name.
    # Reserving it would push the working config into a hash-suffixed filename to avoid a
    # collision with a config that will never be written.
    configs = by_config(runs)
    failures = 0
    for config, entry in list(configs.items()):
        if reproduces(entry["first"], config):
            continue
        del configs[config]
        failures += 1
        recorded = entry["first"]["prompt_version"]
        why = f"prompt {recorded}, this code renders {PROMPT_VERSION}" if recorded != PROMPT_VERSION else "parameters do not re-render it"
        print(f"SKIP  {config}  ({len(entry['runs'])} run(s)): {why}")

    taken = {}
    for entry in configs.values():
        taken.setdefault(name_for(entry["first"], taken), entry["first"]["config_hash"])

    for config, entry in configs.items():
        run, name = entry["first"], name_for(entry["first"], taken)
        path = store.CONFIGS / f"{name}.yml"

        if path.is_file():
            params = yaml.safe_load(path.read_text(encoding="utf-8"))
            ok = reproduces(params, config)
            print(f"{'ok  ' if ok else 'DRIFT'} {path.name:<28} {config}  ({len(entry['runs'])} run(s))")
            failures += not ok
            continue

        if args.check:
            print(f"MISSING {path.name:<26} {config}")
            failures += 1
            continue

        path.write_text(as_file(run, entry["runs"], name), encoding="utf-8")
        print(f"wrote {path.name:<28} {config}  ({len(entry['runs'])} run(s))")

    if failures:
        print(f"\n{failures} config(s) need attention.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
