"""OpenRouter client for the experiment. Deliberately NOT the app's client.

`app/lib/openrouter.ts` falls through a chain of four models whenever one is rate-limited,
which is right for a user waiting on a page and fatal here: the whole experiment is an
attribution of questions to the model that wrote them, and a silent fallback would file
gemma's output under nemotron's name. This client pins one model and fails.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
TIMEOUT_S = 120

#: One retry, then the failure is recorded and the run continues. Free-pool rate limits are
#: transient enough that a single retry recovers most of them, and a run that dies on the
#: third model out of five wastes the requests already spent.
MAX_ATTEMPTS = 2

#: The free tier allows 20 requests/minute, so the failure a retry most often meets is a
#: rate limit. Retrying in the same millisecond reproduces it exactly — the pause is what
#: makes the retry worth spending a request on.
RETRY_PAUSE_S = 20


class GenerationError(Exception):
    """The model did not return usable output. Recorded as a result, never swallowed."""


class FatalError(GenerationError):
    """A failure a retry cannot fix — a rejected key fails identically every time."""


def load_api_key() -> str:
    """Reads experiments/.env — the app's .env.local is never touched."""
    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        return key

    env_file = Path(__file__).resolve().parents[2] / ".env"
    if env_file.is_file():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            if name.strip() == "OPENROUTER_API_KEY":
                key = value.strip().strip("'\"")
                if key:
                    return key

    raise FatalError(
        f"OPENROUTER_API_KEY is not set. Copy {env_file.parent}/.env.example to .env and add your key."
    )


def chat_json(model: str, prompt: str, schema: dict, api_key: str) -> tuple[dict, int]:
    """Calls one pinned model with a forced JSON schema.

    Returns the parsed body and the elapsed milliseconds. Raises `GenerationError` after
    the last attempt — the caller records that as a failed row rather than aborting.
    """
    payload = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema["name"], "strict": True, "schema": schema["schema"]},
            },
        }
    ).encode()

    failures = []
    for attempt in range(MAX_ATTEMPTS):
        started = time.monotonic()
        try:
            return _attempt(payload, api_key), round((time.monotonic() - started) * 1000)
        except FatalError:
            # A rejected key fails the same way on every model, so burning the retry and
            # then the remaining four models just prints the same message five times.
            raise
        except GenerationError as error:
            failures.append(f"attempt {attempt + 1}: {error}")
            if attempt + 1 < MAX_ATTEMPTS:
                time.sleep(RETRY_PAUSE_S)

    raise GenerationError(" | ".join(failures))


def _attempt(payload: bytes, api_key: str) -> dict:
    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode()[:160]
        if error.code in (401, 403):
            raise FatalError(f"OpenRouter rejected the API key (HTTP {error.code}): {detail}") from error
        raise GenerationError(f"HTTP {error.code}: {detail}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise GenerationError(f"no response within {TIMEOUT_S}s: {error}") from error

    # OpenRouter reports upstream failures as HTTP 200 with an error object in the body,
    # so a 2xx status is not enough.
    if body.get("error"):
        error = body["error"]
        detail = (error.get("metadata") or {}).get("provider_error_code") or error.get("message")
        raise GenerationError(f"{error.get('code', 'error')} {detail}")

    content = (body.get("choices") or [{}])[0].get("message", {}).get("content")
    if not isinstance(content, str):
        finish = (body.get("choices") or [{}])[0].get("finish_reason")
        raise GenerationError(f"no message content (finish_reason: {finish})")

    try:
        return json.loads(content)
    except json.JSONDecodeError as error:
        raise GenerationError(f"invalid JSON: {content[:160]}") from error
