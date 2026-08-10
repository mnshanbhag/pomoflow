# PomoFlow

A minimalist Pomodoro timer with configurable focus and break durations.
Entirely static — no backend, no build step.

## Run locally

Any static file server pointed at `public/` works:

```bash
cd /home/mitesh/agy-projects/pomoflow
python3 -m http.server 3100 --directory public
```

Then open `http://localhost:3100`.

Opening `public/index.html` directly via `file://` also works, but the paths
in `index.html` are absolute (`/app.js`), so prefer the server.

## Layout

```
pomoflow/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js      # timer + localStorage store
└── README.md
```

## Storage

Preferences, today's stats, and the last 10 sessions live in `localStorage`
under the key `pomoflow.state.v1`. State is **per browser** — it does not sync
across devices, and clearing site data resets it.

Today's counters roll over automatically when the calendar day changes; the
history list is global and keeps the most recent 10 entries.

Preferences save themselves as you change them — there is no save button.

## Reset

**Stats only:** open Settings and use **Clear stats**. This zeroes today's
counters and empties the session history; your preferences are kept.

**Everything, including preferences:** clear the key from the browser console,
then reload.

```js
localStorage.removeItem("pomoflow.state.v1");
```

## Deploy

Static deploy on Vercel — framework preset **Other**, no build command, output
directory `public`.

```bash
vercel          # preview
vercel --prod   # promote
```
