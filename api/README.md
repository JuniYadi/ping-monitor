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
  - `source` is derived from `sourceMeta.hostname` and identifies the sender node.
  - Request no longer accepts raw ping output.

- `GET /ping` and `GET /nodes` now return each monitored node with latest ping status:
  - one row per posting node (`source`, derived from hostname)
  - includes a `hostname` field for easy node-level identity
  - `status` is `connected` or `disconnected`
  - includes latest metrics, timestamps, and parsed `sourceMeta` for node identity

- `GET /status` returns the last computed network health.

- Cron is configured for every minute in `wrangler.jsonc` with a 75-second staleness window, so if no `POST /ping` arrives for ~75 seconds, health is marked as down.

## Email worker test endpoint

- `GET /test/email` and `POST /test/email` send a fixed ASCII node-status test email to confirm Cloudflare send-email binding is working.
- Endpoint is behind existing Basic Auth.
- Configure in `wrangler.jsonc`:
  - `EMAIL_TEST_RECIPIENT`: destination email for the test send
  - `EMAIL_FROM_ADDRESS`: sender address used by the test message; if set with comma-separated addresses, only the first valid value is used.
  - `EMAIL_TEST_NODE_STATUS` (optional): `up` or `down` to force template style. Defaults to `up`.

Example body (NODE UP):

```txt
+===============================================================+
|                     PING MONITOR ALERT                        |
+===============================================================+
| Event       : NODE UP                                         |
| Node        : api-node-01                                   |
| Source      : ping-monitor@network-internal.hugeshop.com      |
| Target      : network-internal.hugeshop.com                 |
| Status      : connected                                     |
| Recorded At (ISO)    : 2026-05-03T01:02:03.000Z           |
| Recorded At (Sydney) : Sunday 3 May 2026 at 11:02:03 AEST    |
| Packet Loss : 0                                           |
| Latency ms  : min/avg/max = -/-/- |
| Std Dev     : -                                          |
+---------------------------------------------------------------+
| Reason      : Test trigger from /test/email                  |
| Notes       : Heartbeat received and network reachable.     |
| Action      : No action required.                         |
+===============================================================+
```

Successful responses return `ok: true` and may include `messageId`; failures return `ok: false` and error details.

### D1 migration

Apply schema in local Cloudflare D1:

```txt
bunx wrangler d1 execute PING_DB --local --file ./migrations/0001_init.sql
```

For production D1, run the same migration without `--local` after creating/binding your DB in Wrangler:

```txt
bunx wrangler d1 execute PING_DB --file ./migrations/0001_init.sql
```

Apply source index migration when needed:

```txt
bunx wrangler d1 execute PING_DB --local --file ./migrations/0002_source_index.sql
```

For production with source-based indexing:

```txt
bunx wrangler d1 execute PING_DB --file ./migrations/0002_source_index.sql
```

If this is an existing deployment, run migration once before you send traffic so schema is ready.

`api/migrations/0001_init.sql` is the source of truth for schema migrations.
`ensureSchema` is removed from runtime. API routes now fail fast if required tables are missing, so migrations must be applied before traffic starts.
