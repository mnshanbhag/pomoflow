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
`node scripts/stamp-version.mjs`, configured in `vercel.json`. `installCommand`
is deliberately a no-op: there are no dependencies to install.

- Production: https://pomoflow-henna.vercel.app
- Repo: https://github.com/mnshanbhag/pomoflow (private)

### Everyday deploys

The Vercel project is connected to the GitHub repo, so deploys are automatic:

- push to `main` → production
- push any other branch → preview URL

To deploy manually from a working copy instead:

```bash
vercel          # preview
vercel --prod   # production
```

### First-time setup

Already done for this project — recorded so it can be reproduced if the
project is ever re-linked, forked, or moved.

```bash
# 1. Authenticate (interactive — opens a browser device flow)
npx vercel login
gh auth login                 # if the GitHub CLI isn't already signed in

# 2. Create the GitHub repo and push
gh repo create pomoflow --private --source=. --remote=origin --push

# 3. Create the Vercel project and deploy once
npx vercel --yes

# 4. Wire GitHub -> Vercel so pushes deploy themselves
npx vercel git connect --yes
```

Two things worth knowing:

- **Step 3 deploys to production, not preview.** Vercel assigns a project's
  first deployment to production regardless of flags. Later runs of plain
  `vercel` are previews as expected.
- **Step 4 is what makes auto-deploy work.** Steps 1–3 leave you with a live
  site that only updates when you run the CLI by hand.

### Verifying a deploy

The footer is stamped at build time, so it doubles as a deploy check:

```bash
curl -s https://pomoflow-henna.vercel.app/version.js
# window.__POMOFLOW_BUILD__ = {"version":"1.0.1","date":...,"commit":"a1f584b"};
```

If `commit` matches the SHA you just pushed, the new build is live.
