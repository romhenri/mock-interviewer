# Architecture

The Next.js app: pick a role, answer three generated questions, get each answer scored by an LLM
judge. Folder framing — every box is a directory. There is no database; everything that survives
a page load lives in the browser.

```
┌────────────────────┐
│      app/app       │
│ pages + API routes │
└────────────────────┘
          │
          ▼ imports
     ┌─────────┐    HTTPS     ┌────────────────┐
     │ app/lib │ ◀──────────▶ │ OpenRouter API │
     └─────────┘              └────────────────┘
          │
          ▼ read/write
 ┌─────────────────┐
 │ browser storage │
 └─────────────────┘
```

Vertical arrows are one-way dependencies. OpenRouter sits to the side on a two-way arrow
because it is a blocking request/response, not a place this app writes to.

## The boxes

**app/app** — Four client pages (`/`, `/interview`, `/summary`, `/cache`) and two route handlers
(`api/generate-questions`, `api/score-answer`). One box because the split is not architectural:
pages call the routes over HTTP, and both import from `lib/` directly. The server-side
`OPENROUTER_API_KEY` stays in the route handlers; the pages never see it.

**app/lib** — All the logic. `openrouter.ts` (the four-model fallback chain, server-only),
`prompts.ts`, `score.ts` (judge-response validation and per-criterion averaging), `session.ts`,
`bookmarks.ts`, `apiKey.ts`, `types.ts`. The tested pieces are `score.ts`, `session.ts` and
`bookmarks.ts` — the two places a wrong number could appear silently, plus the storage they
read from.

**browser storage** — `sessionStorage` under `mock-interview-session` for the live interview,
`localStorage` under `mock-interview-bookmarks` for saved questions, `mock-interview-settings`
for the Settings modal, and the user's own pasted key. Closing the tab ends the interview;
bookmarks and settings outlive it.

**app/components** — one file (`BookmarkButton.tsx`), folded into `app/app` above rather than
given a box.

## Worth noting

`openrouter.ts` falls through up to four models because the free pool rate-limits often enough
that a single-model call is unusable. That means the judge can change mid-interview, so each
score records the model that produced it and `/summary` warns when more than one judged.

Generation returns each question with the full-credit answer it expects, and the judge scores
against that answer instead of inventing its own bar per call. It costs nothing — the generator
already knows what it is asking — and it means the answer shown to the candidate is the one the
score was measured against. Questions reused from bookmarks may predate it, so the reference is
nullable and the judge falls back to writing one.

Settings (`lib/settings.ts`) only ever reorders or skips work, never breaks it. The priority model
is sent as `x-openrouter-model` and moves to the head of the chain — validated against
`lib/models.ts` on both sides, because it ends up in an outbound API call — and the rest of the
chain still covers for it. The question source picks between generating, mixing in bookmarks
(`pickQuestions`) and drawing from bookmarks alone (`pickCached`, which spends no request).

Both routes validate the model's reply *inside* `chatJSON`, as the `parse` argument. A free model
ignoring the schema is that model's failure and the chain moves to the next one; validating after
the chain returned meant one malformed reply failed a request with three working models untried.

The prompt in `lib/prompts.ts` has a fork in `experiments/`, which measures question quality
against the same assignment across models — this change was ported from it. Findings there do not
reach here automatically — see [../experiments/ARCHITECTURE.md](../experiments/ARCHITECTURE.md).
