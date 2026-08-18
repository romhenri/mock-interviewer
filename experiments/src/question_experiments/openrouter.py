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

#: Wall clock a single request may take, start to finished body. Used as the socket timeout
#: too, but the socket timeout alone does not bound anything: OpenRouter holds a
#: non-streaming connection open while the model works and pads it to keep it alive, and
#: every byte of padding resets a socket timeout. That is how one request in this project
#: ran 466s under a 120s socket timeout while a model looped on a single token.
#:
#: Three minutes. Note that the slowest *successful* response on record is 221s
#: (lfm-2.5-2.6b, 15 subjects), so runs of that size will now record a timeout where they
#: previously recorded questions. The 3-question run the app actually makes finishes inside
#: 80s for every model measured so far.
TIMEOUT_S = 180

#: Read granularity. Only the deadline check between chunks depends on it, so it trades a
#: syscall per 8KB against how long past the deadline a stalled read can hang.
CHUNK_BYTES = 8192

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


#: Fields this client owns. A config setting one of them would not be an experiment, it
#: would be a broken client: `model` breaks the pinning the whole project rests on,
#: `stream` breaks the parsing, and `usage` carries the accounting the cost column is made
#: of. Everything else OpenRouter accepts is fair game.
RESERVED = ("model", "messages", "response_format", "stream", "usage")


def chat_json(
    model: str,
    prompt: str,
    schema: dict,
    api_key: str,
    request: dict | None = None,
    timeout: float | None = None,
    retry: bool | None = None,
    retry_pause: float | None = None,
) -> tuple[dict, int, dict]:
    """Calls one pinned model with a forced JSON schema.

    `timeout` is per request, in seconds, defaulting to `TIMEOUT_S`. Per *request*, not per
    model and not per run: a model that fails and retries is given the full budget twice,
    because the retry exists to survive a rate limit and half a budget would meet the same
    wall with less room.

    `retry` turns the second attempt on or off, `retry_pause` sets the wait between the two.
    The pause is what makes a retry worth a request against a rate limit, and it is also
    what dominates the clock: five models retrying after 20s spend 100s asleep whatever the
    timeout is. Turning the retry off measures the pool as it is rather than as it is after
    a second chance, which is a different number and hashes differently.

    `request` is whatever sampling settings the config asked for (`temperature`,
    `max_tokens`, `top_p`, `seed`, ...). It is passed through rather than enumerated,
    because the list of knobs a provider accepts is theirs to change, and a wrapper that
    names each one is a list to keep in sync for no gain. The settings are part of
    `config_hash`, so a run at a different temperature cannot pool with this one.

    Returns the parsed body, the elapsed milliseconds and the usage (tokens and dollars,
    see `_usage`). Raises `GenerationError` after the last attempt — the caller records that as a failed row rather than aborting.
    """
    reserved = sorted(set(request or {}) & set(RESERVED))
    if reserved:
        raise FatalError(f"request settings may not override {reserved}: this client owns them")

    # Config errors, not model results: they would fail identically on all five models, and
    # a zero or negative budget cannot record anything but timeouts.
    timeout = TIMEOUT_S if timeout is None else timeout
    if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or timeout <= 0:
        raise FatalError(f"timeout must be a positive number of seconds, got {timeout!r}")

    if retry is not None and not isinstance(retry, bool):
        raise FatalError(f"retry must be true or false, got {retry!r}")

    pause = RETRY_PAUSE_S if retry_pause is None else retry_pause
    if not isinstance(pause, (int, float)) or isinstance(pause, bool) or pause < 0:
        raise FatalError(f"retry_pause must be a number of seconds, got {retry_pause!r}")

    attempts = MAX_ATTEMPTS if retry is None or retry else 1

    payload = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema["name"], "strict": True, "schema": schema["schema"]},
            },
            # OpenRouter's accounting extension. Token counts come back without it; `cost`
            # does not, and that is the number the whole cost column rests on. Asking the
            # provider what it charged beats multiplying tokens by a price list here that
            # goes stale the day a model is repriced.
            "usage": {"include": True},
            **(request or {}),
        }
    ).encode()

    failures = []
    for attempt in range(attempts):
        started = time.monotonic()
        try:
            questions, usage = _attempt(payload, api_key, timeout)
            return questions, round((time.monotonic() - started) * 1000), usage
        except FatalError:
            # A rejected key fails the same way on every model, so burning the retry and
            # then the remaining four models just prints the same message five times.
            raise
        except GenerationError as error:
            failures.append(f"attempt {attempt + 1}: {error}")
            if attempt + 1 < attempts:
                time.sleep(pause)

    raise GenerationError(" | ".join(failures))


def _read_within(response, seconds: float) -> bytes:
    """Reads the body, giving up once `seconds` have passed since the read started.

    The deadline is checked between chunks rather than enforced on the socket, because the
    connection is never silent long enough for a socket timeout to fire: the padding that
    keeps it open counts as traffic.

    `read1` rather than `read`, and this is the whole fix: `read(8192)` blocks until 8192
    bytes have arrived, so a trickle of padding stalls it for as long as the trickle lasts
    and the deadline below is simply not reached. `read1` returns after one socket read, so
    the check happens per packet. Measured against a server padding 20 bytes every 200ms, a
    2s budget took 81.6s with `read` and 2.0s with `read1`.

    Abandoning the body abandons the request. The tokens were already spent, so nothing is
    saved by waiting for them, and a run of five models must not be held up for the length
    of one model's degenerate loop.
    """
    deadline = time.monotonic() + seconds
    chunks = []
    while chunk := response.read1(CHUNK_BYTES):
        chunks.append(chunk)
        if time.monotonic() > deadline:
            raise GenerationError(
                f"still sending after {seconds:.0f}s, gave up at {sum(map(len, chunks))} bytes"
            )
    return b"".join(chunks)


#: A request that produced no usage, so every reader sees the same keys on every row.
#: None rather than 0: a provider that reports nothing did not serve a free request, and
#: summing it as one would understate the bill.
NO_USAGE = {"prompt_tokens": None, "completion_tokens": None, "cost_usd": None}


def _usage(body: dict) -> dict:
    """What the request cost, as the provider reports it.

    `cost` is in credits, which are dollars. It is the provider's own number rather than
    tokens multiplied by a price list kept here, because that list would be wrong the day
    a model is repriced and wrong silently.
    """
    usage = body.get("usage") or {}
    return {
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "cost_usd": usage.get("cost"),
    }


def _attempt(payload: bytes, api_key: str, timeout: float) -> tuple[dict, dict]:
    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(_read_within(response, timeout))
    except urllib.error.HTTPError as error:
        detail = error.read().decode()[:160]
        if error.code in (401, 403):
            raise FatalError(f"OpenRouter rejected the API key (HTTP {error.code}): {detail}") from error
        raise GenerationError(f"HTTP {error.code}: {detail}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise GenerationError(f"no response within {timeout:.0f}s: {error}") from error

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
        return json.loads(content), _usage(body)
    except json.JSONDecodeError as error:
        raise GenerationError(f"invalid JSON: {content[:160]}") from error
