# RUN.md

## Setup
```bash
cd app && npm install
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
.venv/bin/kedro run --params experiment.config=ai-engineer-rookie-3   # saved config
.venv/bin/kedro run --params experiment.sample=3                      # 3 subjects, app's shape
.venv/bin/python trace.py  # write conf/experiments/*.yml for configs already run
.venv/bin/python rate.py   # rate 1-5, blind, resumable
.venv/bin/python metrics.py
.venv/bin/python metrics.py --mlflow   # write the ratings onto the MLflow runs
.venv/bin/mlflow ui --backend-store-uri sqlite:///mlflow.db --port 5005   # from experiments/
```
