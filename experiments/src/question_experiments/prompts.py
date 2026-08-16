"""Prompt v1 — a copy of the app's `questionsPrompt`, adapted for the experiment.

This is a deliberate fork of `app/lib/prompts.ts`. The experiments project is isolated:
it never imports from the app, and editing this file does not change what the app ships.
A finding here reaches production only when someone hand-ports it back.

Two differences from the app, both required by the experiment design:

1. The app asks for 3 questions and lets the model pick the areas. Here every model gets
   the *same* assignment — one question per subject, all of them — so that a human rating
   model A against model B is comparing questions about the same material rather than
   comparing subject choices.
2. Each item carries its subject back, so subject compliance is machine-checkable
   instead of a judgement call.
3. Each item also carries the answer the model would accept, written in the same request.
   A separate scoring call would cost a request per question and measure a second model;
   asked here it is free, and it gives the rater the evidence a question is answerable —
   a question whose own model answer is vague is a bad question.
"""

from __future__ import annotations

import hashlib
import json
from string import Template

#: Copied verbatim from the app — questions must stay answerable in this budget.
#: A config can override it (`answer_length:`) because the budget is itself worth an
#: experiment: a question that only works at 5 sentences is a different question.
ANSWER_LENGTH = "2–3 sentences"

#: v2 added the model answer to each item. Bumped because the manifest records this string,
#: and one label covering two different prompts makes every old manifest a lie.
PROMPT_VERSION = "v2"

#: The config fields that reach the client instead of the prompt. Named once because three
#: places must agree on the list: the hash (below), the node that passes them to the client,
#: and `trace.py`, which writes them back into a config file. A field missing from one of
#: those is a config that runs differently than it reads.
CLIENT_SETTINGS = ("request", "timeout", "retry", "retry_pause")


def is_set(value) -> bool:
    """Whether a config actually chose this, as opposed to leaving it out.

    `False` and `0` are choices — `retry: false` is the whole point of that field — so this
    cannot be a truth test. Only absence and the empty container mean "not chosen".
    """
    return value is not None and value != {} and value != ""


def questions_schema(subjects: list[str]) -> dict:
    """Strict JSON schema: one item per subject — subject tag, question, and model answer.

    `enum` constrains the tag to the assignment, so a model cannot invent a subject —
    but nothing stops it tagging a question "RAG" and writing about CNNs. That is what
    a human rating catches, and why the tag is checked as *data* rather than trusted.

    `answer` is required rather than optional: a model that skips it has not done the
    assignment, and an optional field would let that pass as a full result.
    """
    return {
        "name": "interview_questions",
        "schema": {
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "subject": {"type": "string", "enum": subjects},
                            "question": {"type": "string"},
                            "answer": {"type": "string"},
                        },
                        "required": ["subject", "question", "answer"],
                        "additionalProperties": False,
                    },
                    "minItems": len(subjects),
                    "maxItems": len(subjects),
                },
            },
            "required": ["questions"],
            "additionalProperties": False,
        },
    }


def questions_prompt(
    role: str,
    level: str,
    subjects: list[str],
    answer_length: str = ANSWER_LENGTH,
    template: str | None = None,
) -> str:
    """Renders the built-in prompt, or a config's own template in its place.

    A custom template is substituted with `string.Template`, so its placeholders are
    `$role`, `$level`, `$count`, `$subjects` (the numbered list) and `$answer_length`.
    Dollar signs rather than braces because a prompt is prose full of JSON and code
    fragments, and `str.format` would make every literal brace an error to escape.

    `substitute` rather than `safe_substitute`: a typo like `$levl` fails here, where the
    fix is free, instead of shipping the literal text to five models at 5 requests a run.
    """
    count = len(subjects)
    subject_list = "\n".join(f"{i + 1}. {s}" for i, s in enumerate(subjects))

    if template is not None:
        return Template(template).substitute(
            role=role,
            level=level,
            count=count,
            subjects=subject_list,
            answer_length=answer_length,
        )

    return f"""You are a senior technical interviewer hiring for a {level}-level {role} position.

Write exactly {count} interview questions for this role — one for each subject below, in
this order. Return each question tagged with the subject it belongs to, and with the
answer you would accept as full credit.

{subject_list}

Pitch every question at the {level} level: ask what someone at that level is expected to know, and
nothing beyond it. A {level} candidate who knows their job should be able to answer all of them.

The candidate answers out loud, in {answer_length}. Every question must be fully
answerable in that space by someone who knows the material.

Rules:
- Ask about ONE concept per question. Never join two questions with "and" — "What is X, and
  how does it differ from Y?" is two questions and does not fit the length budget.
- Prefix each question with a short topic label, then a colon.
- Be specific. Name the actual technology, pattern or failure mode. A question that could
  appear in any interview for any role is a bad question.
- Use each subject exactly once. Do not repeat a subject and do not skip one.
- No code, no diagrams, no "walk me through your experience with…" biography questions.
- Return only the questions, with no numbering or preamble.

For every question, also write the answer. It is the answer you would give full credit to,
and it must fit the same {answer_length} the candidate has — it shows what a complete answer
looks like at that length. Write it the way a candidate would say it out loud, not as advice
about what to say. Name the actual mechanism; an answer that restates the question in other
words is not a full-credit answer.

Good examples of the shape and scope:
- "Reverse Proxy: What is the primary function of a reverse proxy in a system architecture?"
- "Cache Invalidation: What is a cache stampede, and what triggers it?"
- "Connection Management: Why do application servers handling thousands of concurrent
  requests need connection pooling?"

Bad — too broad to answer in {answer_length}:
- "Explain the inner workings and appropriate use cases for Cache-Aside, Read-Through and
  Write-Through caching patterns."
- "How do consensus algorithms like Raft or Paxos solve leader election, and what are the
  trade-offs between them?\""""


def config_hash(prompt: str, schema: dict, settings: dict | None = None) -> str:
    """Identifies what a run measured, so runs are only pooled when they are comparable.

    The rendered prompt carries role, level, the subject list, the answer budget and the
    wording; the schema carries the count and the permitted subjects. Both constrain the
    task, and the schema can be loosened without touching a word of the prompt — so both
    are hashed. Change any of them and the hash moves, which is the point: ratings
    collected against a different task are ratings of a different artifact.

    `settings` is everything else a config can turn: the sampling settings sent to the API
    (temperature and friends), the per-request timeout, and whether a failed request is
    retried. None of them changes the assignment. Temperature changes the answer, and a
    table averaging temperature 0.2 with 1.0 measures neither; the timeout and the retry
    change which answers arrive at all, and a run that does not retry records failures
    exactly where a retrying run recovers, so pooling them corrupts `fail`. Settings
    join the material only when a config sets one, so every hash recorded before this
    argument existed still renders identically. Defaults must stay free, or every traced
    config breaks the day a knob is added.

    Model is deliberately NOT in the hash. Comparing models is what a run is for, so every
    model in a run must share one.
    """
    material = prompt + json.dumps(schema, sort_keys=True)
    if settings:
        material += json.dumps(settings, sort_keys=True)
    return hashlib.sha256(material.encode()).hexdigest()[:12]


def render(params: dict, subjects: list[str] | None = None) -> tuple[str, dict, str]:
    """Turns an experiment config into the prompt, the schema and the hash of both.

    One function because there are two callers that must agree exactly: the pipeline, which
    renders a config to run it, and `trace.py`, which renders a config to prove a file
    reproduces the hash a past run recorded. Two copies of this would drift, and the symptom
    would be a config file that promises a hash it no longer renders.

    `subjects` is passed in when the caller has already sampled them.
    """
    subjects = params["subjects"] if subjects is None else subjects
    prompt = questions_prompt(
        params["role"],
        params["level"],
        subjects,
        params.get("answer_length") or ANSWER_LENGTH,
        params.get("prompt"),
    )
    schema = questions_schema(subjects)
    # Only the keys a config actually set, so an unset knob leaves the hash where it was.
    settings = {key: params[key] for key in CLIENT_SETTINGS if is_set(params.get(key))}
    return prompt, schema, config_hash(prompt, schema, settings)
