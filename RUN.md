# RUN.md

## Setup
```bash
cd app && npm install
cp .env.local.example .env.local   # OPENROUTER_API_KEY=sk-or-v1-... from https://openrouter.ai/keys
```

## Run
```bash
npm run dev   # :4242
```

## Check
```bash
npm test           # needs Node >= 22.6
npx tsc --noEmit
npm run lint
npm run build
```

## Experiments — separate project, optional
```bash
cd experiments && python3 -m venv .venv && .venv/bin/pip install -e .
cp .env.example .env       # its own OPENROUTER_API_KEY, not the app's
.venv/bin/kedro run        # 5 models x 15 subjects, costs 5 of the 50 free requests/day
.venv/bin/python rate.py   # rate 1-5, blind, resumable
.venv/bin/python metrics.py
```
