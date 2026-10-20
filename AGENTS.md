# AGENTS.md

Notes for coding agents working on avemguvern.ro. See `README.md` for the full setup.

## Deploys

**A push to `main` deploys to production automatically** (Cloudflare's Git
integration runs `wrangler deploy`). There is no staging and no CI gate, so:

- Only push to `main` once the change is verified locally (see below).
- Don't run `npx wrangler deploy` by hand after pushing; it's already done.
- A deploy ships code and `public/` only. The live status lives in KV (`current`
  key), so a status change still needs `POST /api/status` with the admin token
  (see README, "Updating the status"). `DEFAULT_STATUS` in `src/index.ts` is only
  used while KV is empty.

## Before pushing

```sh
npm run typecheck
npm run dev   # wrangler dev on :8787, check /api/status and the page
```

## When the political situation changes

Keep these in sync with each other:

- `DEFAULT_STATUS` in `src/index.ts` and `seed.json`
- the static no-JS fallback in `public/index.html` (`#answer`, `#subtitle`, the
  `#nominee` card, `nomineeState`, `govState`)
- the "Current answer" lines at the top of `README.md`
- `PAST_NOMINEES` in `public/index.html` when a nominee fails
- `GOV_BACKERS` in `public/index.html` when the governing coalition changes

## Conventions

- Site copy is Romanian, written without diacritics (`Inca`, `asteapta`).
- `public/` has no build step; edit `index.html` directly.
