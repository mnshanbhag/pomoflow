# Pomoflow

A minimalist Pomodoro timer with configurable focus and break durations.
See the full spec: `../AgentForge/artifacts/pomoflow_tech_spec.md`.

## Run

```bash
cd ../pomoflow            # if you're inside AgentForge/
# or:  cd /home/mitesh/agy-projects/pomoflow
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py
```

Then open `http://localhost:3100`.

Port 3100 is the default. Override it with `PORT`:

```bash
PORT=3200 .venv/bin/python server.py   # http://localhost:3200
```

## Layout

```
pomoflow/
├── server.py          # Flask backend (3 JSON endpoints + static)
├── requirements.txt
├── progress.json      # auto-created on first POST; persisted state
├── static/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── README.md
```

## Reset

Delete `progress.json` to start with default preferences and zero stats.
