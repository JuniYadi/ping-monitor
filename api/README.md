# API

```txt
bun install
bun run dev
```

```txt
bun run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
bun run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

### Basic auth

Set one of the following variable pairs in your Cloudflare Worker env (secrets recommended):

- `BASIC_AUTH_USERNAME` + `BASIC_AUTH_PASSWORD`
- Legacy pair: `BASIC_AUTH_USER` + `BASIC_AUTH_PASS`

For local runs, export the same vars before starting the worker (or in `bun run dev` environment).

## API changes (ping health)

- `POST /ping` expects JSON with a parsed ping summary (`summary`) and optional `sourceMeta`.
  - `summary` shape matches `PingSummary` (target/tx/rx/packet loss/rt metrics).
  - `sourceMeta` shape:
    - `hostname: string`
    - `platform: string`
    - `arch: string`
    - `ipV4s: string[]`
    - `primaryIpV4: string | null`
  - `target` can be provided at either top-level or inside `summary`.
  - Request no longer accepts raw ping output.

- `GET /ping` now returns each monitored node with latest ping status:
  - one row per node target (latest API record)
  - `status` is `connected` or `disconnected`
  - includes latest metrics, timestamps, and parsed `sourceMeta` for node identity

- `GET /status` returns the last computed network health.

- Cron is configured for every minute in `wrangler.jsonc` with a 75-second staleness window, so if no `POST /ping` arrives for ~75 seconds, health is marked as down.

### D1 migration

Apply schema in local Cloudflare D1:

```txt
bunx wrangler d1 execute PING_DB --local --file ./migrations/0001_init.sql
```

For production D1, run the same migration without `--local` after creating/binding your DB in Wrangler:

```txt
bunx wrangler d1 execute PING_DB --file ./migrations/0001_init.sql
```

If this is an existing deployment, run migration once before you send traffic so schema is ready.

`api/migrations/0001_init.sql` is the source of truth for schema migrations.
`ensureSchema` is removed from runtime. API routes now fail fast if required tables are missing, so migrations must be applied before traffic starts.
