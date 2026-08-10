# PomoFlow

A minimalist Pomodoro timer with configurable focus and break durations.
Static frontend, no backend and no dependencies — the only build step stamps
the version into the footer.

## Run locally

```bash
cd /home/mitesh/projects/pomoflow
npm run dev          # stamps the version, then serves public/ on :3100
```

Then open `http://localhost:3100`.

Any static file server pointed at `public/` also works; without the stamp step
the footer just reads `dev · unreleased`.

## Layout

```
pomoflow/
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js        # timer + localStorage store
│   └── version.js    # generated, gitignored
├── scripts/
│   └── stamp-version.mjs
├── package.json      # holds the version number
└── vercel.json       # build command + output dir
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

## Versioning

`package.json` is the single source of truth. `scripts/stamp-version.mjs` runs
at build time and writes `public/version.js`, which the footer reads — so the
displayed date is always the real deploy date, never a stale literal.

Cut a release with npm's built-in bump (it commits and tags):

```bash
npm version patch    # 1.0.0 -> 1.0.1   bug fixes
npm version minor    # 1.0.0 -> 1.1.0   new features
npm version major    # 1.0.0 -> 2.0.0   breaking changes

git push --follow-tags
```

The push triggers a Vercel build, which re-stamps the footer. Nothing to edit
by hand. The version also carries the short commit SHA as a tooltip.

## Deploy

Static deploy on Vercel — output directory `public`, build command
`node scripts/stamp-version.mjs`, configured in `vercel.json`.

Production: https://pomoflow-henna.vercel.app

The Vercel project is connected to this GitHub repo, so deploys are automatic:

- push to `main` → production
- push any other branch → preview URL

To deploy manually from a working copy instead:

```bash
vercel          # preview
vercel --prod   # production
```
