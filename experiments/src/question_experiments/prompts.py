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

#: Copied verbatim from the app — questions must stay answerable in this budget.
ANSWER_LENGTH = "2–3 sentences"

#: v2 added the model answer to each item. Bumped because the manifest records this string,
#: and one label covering two different prompts makes every old manifest a lie.
PROMPT_VERSION = "v2"


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


def questions_prompt(role: str, level: str, subjects: list[str]) -> str:
    count = len(subjects)
    subject_list = "\n".join(f"{i + 1}. {s}" for i, s in enumerate(subjects))

    return f"""You are a senior technical interviewer hiring for a {level}-level {role} position.

Write exactly {count} interview questions for this role — one for each subject below, in
this order. Return each question tagged with the subject it belongs to, and with the
answer you would accept as full credit.

{subject_list}

Pitch every question at the {level} level: ask what someone at that level is expected to know, and
nothing beyond it. A {level} candidate who knows their job should be able to answer all of them.

The candidate answers out loud, in {ANSWER_LENGTH}. Every question must be fully
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
and it must fit the same {ANSWER_LENGTH} the candidate has — it shows what a complete answer
looks like at that length. Write it the way a candidate would say it out loud, not as advice
about what to say. Name the actual mechanism; an answer that restates the question in other
words is not a full-credit answer.

Good examples of the shape and scope:
- "Reverse Proxy: What is the primary function of a reverse proxy in a system architecture?"
- "Cache Invalidation: What is a cache stampede, and what triggers it?"
- "Connection Management: Why do application servers handling thousands of concurrent
  requests need connection pooling?"

Bad — too broad to answer in {ANSWER_LENGTH}:
- "Explain the inner workings and appropriate use cases for Cache-Aside, Read-Through and
  Write-Through caching patterns."
- "How do consensus algorithms like Raft or Paxos solve leader election, and what are the
  trade-offs between them?\""""


def config_hash(prompt: str, schema: dict) -> str:
    """Identifies what a run measured, so runs are only pooled when they are comparable.

    The rendered prompt carries role, level, the subject list and the wording; the schema
    carries the count and the permitted subjects. Both constrain the task, and the schema
    can be loosened without touching a word of the prompt — so both are hashed. Change any
    of them and the hash moves, which is the point: ratings collected against a different
    task are ratings of a different artifact.

    Model is deliberately NOT in the hash. Comparing models is what a run is for, so every
    model in a run must share one.
    """
    material = prompt + json.dumps(schema, sort_keys=True)
    return hashlib.sha256(material.encode()).hexdigest()[:12]
