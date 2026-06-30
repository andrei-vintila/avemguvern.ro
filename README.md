# avemguvern.ro

A one-question site: **does Romania currently have a (full, non-interim) government?**
Current answer: **Nu! — Inca e interimar Bolojan!**

Everything runs in a single Cloudflare Worker (free tier):

- **Static page** — minimalist verdict, served from `public/`.
- **Public API** — `GET /api/status` (read), `POST /api/status` (admin, token-protected).
- **MCP server** — read-only `get_government_status` tool at `/mcp` (Streamable HTTP).

State is one Cloudflare KV key (`current`). If KV is empty the Worker serves
`DEFAULT_STATUS` from `src/index.ts`, so it works before seeding.

## Project layout

```
public/index.html   # the page (no build step)
src/index.ts        # Worker: routes /api/status, /mcp, else static assets
wrangler.jsonc      # Worker + assets + KV config
seed.json           # initial KV value
```

## Local development

```sh
npm install
npx wrangler dev
```

Then:

```sh
# read
curl http://localhost:8787/api/status

# MCP: list tools
curl -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# MCP: call the tool
curl -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_government_status"}}'
```

For a local admin token during `wrangler dev`, create `.dev.vars`:

```
ADMIN_TOKEN=some-local-token
```

## Deploy

```sh
npm install
npx wrangler login

# 1. Create the KV namespace, then paste the returned id into wrangler.jsonc
npx wrangler kv namespace create GOV_STATUS

# 2. Set the admin token (used to authorize POST /api/status)
npx wrangler secret put ADMIN_TOKEN

# 3. Deploy
npx wrangler deploy

# 4. (optional) Seed the KV value — default already matches
npm run seed
```

### Custom domain

After the first deploy, attach `avemguvern.ro` in the Cloudflare dashboard
(**Workers & Pages → avemguvern-ro → Settings → Domains & Routes**), or add to
`wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "avemguvern.ro", "custom_domain": true }]
```

(DNS for the domain must be on Cloudflare.)

## Updating the status

When the political situation changes, patch the status (only send fields that change):

```sh
curl -X POST https://avemguvern.ro/api/status \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"hasGovernment": true, "answer": "Da!", "subtitle": "Avem guvern plin!", "interim": false, "primeMinister": "..."}'
```

`updatedAt` is stamped automatically.

## Using the MCP server with Claude

Visit `https://avemguvern.ro/mcp` in a browser for setup instructions, or add it directly:

```sh
claude mcp add --transport http avemguvern https://avemguvern.ro/mcp
```

It exposes one read-only tool, `get_government_status`, that returns the current answer
plus the raw status JSON.

## Abuse protection

Built into the Worker:

- **Edge caching** — `GET /api/status` is cached at the Cloudflare edge via the
  Cache API (`caches.default`) for `CACHE_TTL_SECONDS` (default 60), so a read flood
  hits KV at most ~once/minute per data center. A successful `POST` purges the cache
  so updates show immediately. The Cache API is per-colo, so a write purges only the
  data center that served it; other regions refresh when their TTL expires (hence the
  modest default — raise it in `wrangler.jsonc` vars for more offload if you can
  tolerate longer cross-region staleness after a change).
- **Per-IP rate limiting** — native Workers rate-limit bindings: reads 120/min,
  writes 10/min (the write limit also throttles token guessing). Over-limit → `429`.
- **Hardened writes** — `POST` only accepts the known fields
  (`hasGovernment`, `interim`, `answer`, `subtitle`, `primeMinister`) with correct
  types, clamps strings to 200 chars, rejects bodies over 2 KB (`413`), and compares
  the admin token in constant time. A leaked token can't store arbitrary or huge data.

Recommended at the Cloudflare edge (dashboard):

- **WAF Rate Limiting rule** (e.g. per-IP threshold on `/api/*` and `/mcp`) — this is
  the layer that drops abusive traffic *before* it counts against your quota.
- **Bot Fight Mode** under Security → Bots.

> Note: a zone-level **Cache Rule cannot bypass the Worker** here — for a Worker-owned
> route the Worker always executes before the cache is checked
> ([docs](https://developers.cloudflare.com/cache/interaction-cloudflare-products/workers-cache-rules/)).
> The in-Worker Cache API above is the effective edge-cache mechanism; it saves KV
> operations but each request still counts as one Worker invocation. To cut invocations
> themselves, use the WAF rate-limit rule.

## Buy Me a Coffee

The coffee button in `public/index.html` points at
[buymeacoffee.com/andreivintila](https://buymeacoffee.com/andreivintila).
