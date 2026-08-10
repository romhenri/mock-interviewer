# RUN.md

## Setup
```bash
cd app
npm install
cp .env.local.example .env.local   # then set OPENROUTER_API_KEY=sk-or-v1-...
```

## Run
```bash
npm run dev   # :3000
```

## Check
```bash
npm test           # needs Node >= 22.6
npx tsc --noEmit
npm run lint
npm run build
```

## Notes
- `OPENROUTER_API_KEY` is required — every screen past role selection makes an API call. Get one at https://openrouter.ai/keys
- Free tier is 50 requests/day without credits; one interview costs 4.
- `OPENROUTER_MODEL` defaults to `openai/gpt-oss-20b:free`. A replacement must support structured output — the app forces a JSON schema.
- All commands run from `app/`, not the repo root.
