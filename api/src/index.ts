import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import type { PingSummary } from "../../cli";

type SourceMeta = {
  hostname: string;
  platform: string;
  arch: string;
  ipV4s: string[];
  primaryIpV4: string | null;
};

type AnyObject = Record<string, unknown>;

const STALE_WINDOW_MS = 75_000;
const PING_COUNT = 5;

type PingRow = {
  id: number;
  target: string;
  recorded_at: number;
  transmitted: number;
  received: number;
  packet_loss_percent: number;
  min_ms: number | null;
  avg_ms: number | null;
  max_ms: number | null;
  stddev_ms: number | null;
  source: string;
  timeout_ms: number | null;
  note: string | null;
  source_meta: string | null;
};

type BasicAuthSource = {
  BASIC_AUTH_USERNAME?: string;
  BASIC_AUTH_PASSWORD?: string;
  BASIC_AUTH_USER?: string;
  BASIC_AUTH_PASS?: string;
};

type BasicAuthCredentials = {
  username: string;
  password: string;
};

type HealthRow = {
  id: number;
  status: string;
  last_seen_ping: number | null;
  last_checked_at: number;
  reason: string | null;
};

type NodeConnectRow = Omit<PingRow, "id">;

type NodeConnectResponse = {
  target: string;
  hostname: string;
  status: "connected" | "disconnected";
  recordedAt: number;
  transmitted: number;
  received: number;
  packetLossPercent: number;
  minMs: number | null;
  avgMs: number | null;
  maxMs: number | null;
  stddevMs: number | null;
  source: string;
  timeoutMs: number | null;
  note: string | null;
  sourceMeta: SourceMeta | null;
  reason: string;
};

type D1QueryResult<T> = { results: T[] };
type D1ExecuteResult = { success: boolean; meta?: { last_row_id?: number } };

type D1TableInfoRow = { name: string };
type D1IndexInfoRow = { name: string };

type D1PreparedStatement = {
  all: <T>() => Promise<D1QueryResult<T>>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<D1ExecuteResult>;
};

type D1BoundStatement = {
  bind: (...values: Array<number | string | null>) => D1PreparedStatement;
};

type CloudflareBindings = BasicAuthSource & {
  PING_DB: {
    exec: (query: string) => Promise<{ success: boolean }>;
    prepare: (query: string) => D1PreparedStatement & D1BoundStatement;
  };
};

function resolveProcessEnv(name: string): string | undefined {
  if (typeof process !== "undefined") {
    return process.env?.[name];
  }

  if (typeof Bun !== "undefined" && Bun.env) {
    return Bun.env[name];
  }

  return undefined;
}

export function getBasicAuthCredentials(env: BasicAuthSource): BasicAuthCredentials | null {
  const username =
    env.BASIC_AUTH_USERNAME ??
    env.BASIC_AUTH_USER ??
    resolveProcessEnv("BASIC_AUTH_USERNAME") ??
    resolveProcessEnv("BASIC_AUTH_USER");

  const password =
    env.BASIC_AUTH_PASSWORD ??
    env.BASIC_AUTH_PASS ??
    resolveProcessEnv("BASIC_AUTH_PASSWORD") ??
    resolveProcessEnv("BASIC_AUTH_PASS");

  if (!username || !password) {
    return null;
  }

  return { username, password };
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

const UNKNOWN_HOSTNAME = "unknown";
const SOURCE_INDEX_NAME = "idx_ping_records_source_recorded_at";

const REQUIRED_TABLES = ["ping_records", "network_health"] as const;

app.use("*", async (c, next) => {
  const credentials = getBasicAuthCredentials(c.env);
  if (!credentials) {
    return c.json({
      error:
        "Missing basic auth environment variables: BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD (or BASIC_AUTH_USER/BASIC_AUTH_PASS)",
    }, 500);
  }

  return basicAuth(credentials)(c, next);
});

function isObject(value: unknown): value is AnyObject {
  return typeof value === "object" && value !== null;
}

function toText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  return null;
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return fallback;
  }

  return Math.max(0, Math.trunc(numeric));
}

function numberOrNaN(value: unknown): number {
  return toFiniteNumber(value) ?? Number.NaN;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const list: string[] = [];
  for (const item of value) {
    const text = toText(item);
    if (text) {
      list.push(text);
    }
  }

  return list;
}

function parseSourceMeta(value: unknown): SourceMeta | null {
  if (!isObject(value)) return null;

  const hostname = toText(value.hostname);
  const platform = toText(value.platform);
  const arch = toText(value.arch);
  if (!hostname || !platform || !arch) {
    return null;
  }

  const ipV4s = Array.from(new Set(toStringArray(value.ipV4s)));
  const primaryIpV4 = toText(value.primaryIpV4) ?? (ipV4s[0] ?? null);

  return {
    hostname,
    platform,
    arch,
    ipV4s,
    primaryIpV4,
  };
}

function parseSourceMetaFromBody(body: AnyObject): SourceMeta | null {
  if (isObject(body.sourceMeta)) {
    return parseSourceMeta(body.sourceMeta);
  }

  if (isObject((body as AnyObject).source_meta)) {
    return parseSourceMeta((body as AnyObject).source_meta);
  }

  return null;
}

function parseSourceMetaFromStored(value: unknown): SourceMeta | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  return parseSourceMeta(parsed);
}

function mapToSummary(payload: unknown, fallbackTarget: string | null): PingSummary | null {
  if (!isObject(payload)) return null;

  const target = toText(payload.target) ?? toText(payload.host) ?? fallbackTarget;
  if (!target) return null;

  const transmitted = toNonNegativeInt(payload.transmitted, Number.NaN);
  const received = toNonNegativeInt(payload.received, Number.NaN);
  const packetLossPercent = toFiniteNumber(payload.packetLossPercent);

  if (!Number.isFinite(transmitted) || !Number.isFinite(received) || packetLossPercent === null) {
    return null;
  }

  return {
    target,
    transmitted,
    received,
    packetLossPercent,
    minMs: numberOrNaN(payload.minMs),
    avgMs: numberOrNaN(payload.avgMs),
    maxMs: numberOrNaN(payload.maxMs),
    stddevMs: numberOrNaN(payload.stddevMs),
  };
}

function parseSummaryFromBody(body: AnyObject): PingSummary | null {
  const fallbackTarget = toText(body.target) ?? toText(body.host) ?? null;

  if (isObject(body.summary)) {
    return mapToSummary(body.summary, fallbackTarget);
  }

  return mapToSummary(body, fallbackTarget);
}

function fallbackTimeoutSummary(target: string): PingSummary {
  return {
    target,
    transmitted: PING_COUNT,
    received: 0,
    packetLossPercent: 100,
    minMs: Number.NaN,
    avgMs: Number.NaN,
    maxMs: Number.NaN,
    stddevMs: Number.NaN,
  };
}

function dbNumberOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

async function assertSchema(db: CloudflareBindings["PING_DB"]): Promise<void> {
  const missingTables: string[] = [];
  for (const tableName of REQUIRED_TABLES) {
    const table = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .bind(tableName)
      .first<{ name: string }>();

    if (!table?.name) {
      missingTables.push(tableName);
    }
  }

  if (missingTables.length > 0) {
    throw new Error(
      `Missing required D1 tables: ${missingTables.join(", ")}. Run migration 0001_init.sql before starting the API.`,
    );
  }

  const tableInfo = await db.prepare("PRAGMA table_info(ping_records)").all<D1TableInfoRow>();
  const hasSourceMeta = tableInfo.results.some((column) => column.name === "source_meta");
  if (!hasSourceMeta) {
    throw new Error(
      'Schema out of date: ping_records is missing required column "source_meta". Run migration 0001_init.sql.',
    );
  }

  const indexInfo = await db.prepare("PRAGMA index_list(ping_records)").all<D1IndexInfoRow>();
  const hasSourceIndex = indexInfo.results.some(
    (index) => index.name === SOURCE_INDEX_NAME,
  );
  if (!hasSourceIndex) {
    throw new Error(
      `Schema optimization missing: ping_records is missing index "${SOURCE_INDEX_NAME}". Run migration 0002_source_index.sql.`,
    );
  }
}

function isValidSummary(summary: PingSummary): boolean {
  return (
    Number.isFinite(summary.transmitted) &&
    Number.isFinite(summary.received) &&
    Number.isFinite(summary.packetLossPercent)
  );
}

async function insertPingRecord(
  db: CloudflareBindings["PING_DB"],
  payload: {
    target: string;
    summary: PingSummary;
    source: string;
    timeoutMs: number | null;
    note: string | null;
    sourceMeta: SourceMeta | null;
  },
): Promise<number | null> {
  const now = Date.now();

  const result = await db
    .prepare(
      `INSERT INTO ping_records
        (target, recorded_at, transmitted, received, packet_loss_percent, min_ms, avg_ms, max_ms, stddev_ms, source, timeout_ms, note, source_meta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      payload.target,
      now,
      payload.summary.transmitted,
      payload.summary.received,
      payload.summary.packetLossPercent,
      dbNumberOrNull(payload.summary.minMs),
      dbNumberOrNull(payload.summary.avgMs),
      dbNumberOrNull(payload.summary.maxMs),
      dbNumberOrNull(payload.summary.stddevMs),
      payload.source,
      payload.timeoutMs,
      payload.note,
      payload.sourceMeta ? JSON.stringify(payload.sourceMeta) : null,
    )
    .run();

  return result.meta?.last_row_id ?? null;
}

async function upsertHealth(
  db: CloudflareBindings["PING_DB"],
  status: "up" | "down",
  lastSeenPing: number | null,
  checkedAt: number,
  reason: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO network_health (id, status, last_seen_ping, last_checked_at, reason)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         last_seen_ping = excluded.last_seen_ping,
         last_checked_at = excluded.last_checked_at,
         reason = excluded.reason`,
    )
    .bind(status, lastSeenPing, checkedAt, reason)
    .run();
}

async function getLatestApiPingAt(db: CloudflareBindings["PING_DB"]): Promise<number | null> {
  const result = await db
    .prepare(
      `SELECT recorded_at
       FROM ping_records
       WHERE source != '__cron__'
       ORDER BY recorded_at DESC
       LIMIT 1`,
    )
    .first<Pick<PingRow, "recorded_at">>();

  return result ? result.recorded_at : null;
}

async function getLatestApiPingPacketLoss(db: CloudflareBindings["PING_DB"]): Promise<number | null> {
  const result = await db
    .prepare(
      `SELECT packet_loss_percent
       FROM ping_records
       WHERE source != '__cron__'
       ORDER BY recorded_at DESC
       LIMIT 1`,
    )
    .first<{ packet_loss_percent: number }>();

  return result ? result.packet_loss_percent : null;
}

async function getCurrentHealth(db: CloudflareBindings["PING_DB"]): Promise<HealthRow | null> {
  return await db
    .prepare(`SELECT * FROM network_health WHERE id = 1`)
    .first<HealthRow>();
}

function buildNodeConnection(row: NodeConnectRow, now: number): NodeConnectResponse {
  const sourceMeta = parseSourceMetaFromStored(row.source_meta);
  const hostname = sourceMeta?.hostname ?? row.source ?? UNKNOWN_HOSTNAME;

  const isConnected =
    row.packet_loss_percent < 100 && now - row.recorded_at < STALE_WINDOW_MS;

  return {
    target: row.target,
    hostname,
    status: isConnected ? "connected" : "disconnected",
    recordedAt: row.recorded_at,
    transmitted: row.transmitted,
    received: row.received,
    packetLossPercent: row.packet_loss_percent,
    minMs: row.min_ms,
    avgMs: row.avg_ms,
    maxMs: row.max_ms,
    stddevMs: row.stddev_ms,
    source: row.source,
    timeoutMs: row.timeout_ms,
    note: row.note,
    sourceMeta,
    reason: isConnected ? "Latest ping report has reachable packets" : "Down or timed out",
  };
}

async function getLatestApiNodes(db: CloudflareBindings["PING_DB"]): Promise<NodeConnectRow[]> {
  const rows = await db
    .prepare(
      `SELECT *
       FROM ping_records
       WHERE id IN (
        SELECT MAX(id)
          FROM ping_records
          WHERE source != '__cron__'
          GROUP BY source
        )
       ORDER BY recorded_at DESC`,
    )
    .all<NodeConnectRow>();

  return rows.results;
}

function toRelativeTime(epochMs: number | null): string {
  if (!epochMs) {
    return "-";
  }

  const ageMs = Date.now() - epochMs;
  if (ageMs < 0) {
    return "-";
  }

  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatLatency(node: NodeConnectResponse): string {
  if (node.packetLossPercent >= 100) {
    return "-";
  }

  if (Number.isNaN(node.avgMs)) {
    return "-";
  }

  return `${node.avgMs.toFixed(1)} ms`;
}

function renderNodeStatusPage(nodes: NodeConnectResponse[]): string {
  const rows = nodes
    .map(
      (node) => `
      <tr class="${node.status === "connected" ? "online" : "offline"}">
        <td>${node.target}</td>
        <td>${node.hostname}</td>
        <td>${node.status}</td>
        <td>${formatLatency(node)}</td>
        <td>${toRelativeTime(node.recordedAt)}</td>
        <td>${node.source}</td>
        <td>${node.reason}</td>
      </tr>
    `,
    )
    .join("");

  const tableRows = rows || `
    <tr>
      <td colspan="7">No node data available yet.</td>
    </tr>
  `;

  const updatedAt = new Date().toLocaleString();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Node Status</title>
    <style>
      :root {
        --bg: #f2f5fb;
        --text: #111827;
        --muted: #6b7280;
        --line: #d9e0ee;
        --card: #ffffff;
        --ok: #047857;
        --bad: #b91c1c;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 24px;
        min-height: 100vh;
        font-family: "Manrope", "Avenir Next", "Segoe UI", sans-serif;
        background: radial-gradient(circle at top, #f9fbff, var(--bg));
        color: var(--text);
      }

      .wrap {
        max-width: 960px;
        margin: 0 auto;
      }

      h1 {
        margin: 0 0 12px;
      }

      .card {
        border: 1px solid var(--line);
        border-radius: 12px;
        overflow: hidden;
        background: var(--card);
        box-shadow: 0 14px 26px rgba(30, 41, 59, 0.08);
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      thead {
        background: #f8fafc;
      }

      th,
      td {
        text-align: left;
        padding: 12px 14px;
        border-bottom: 1px solid var(--line);
        font-size: 0.94rem;
      }

      th {
        font-weight: 700;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 0.74rem;
      }

      .online td:nth-child(3) {
        color: var(--ok);
        font-weight: 600;
      }

      .offline td:nth-child(3) {
        color: var(--bad);
        font-weight: 600;
      }

      .meta {
        margin-top: 10px;
        color: var(--muted);
        font-size: 0.88rem;
      }

      td:last-child {
        color: var(--muted);
        max-width: 260px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Node Status</h1>
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Hostname</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Last Update</th>
              <th>Source</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <div class="meta">Updated: ${updatedAt}</div>
    </div>
  </body>
</html>`;
}

async function renderNodeJson(db: CloudflareBindings["PING_DB"]): Promise<{ generatedAt: number; total: number; nodes: NodeConnectResponse[] }>
  {
    const now = Date.now();
    const nodesRows = await getLatestApiNodes(db);
    const nodes = nodesRows.map((row) => buildNodeConnection(row, now));

    return {
      generatedAt: now,
      total: nodes.length,
      nodes,
    };
  }

app.get("/", async (c: any) => {
  const db = c.env.PING_DB;
  await assertSchema(db);

  const response = await renderNodeJson(db);

  return c.html(renderNodeStatusPage(response.nodes));
});

app.get("/status", async (c: any) => {
  const db = c.env.PING_DB;
  await assertSchema(db);
  const health = await getCurrentHealth(db);
  return c.json({
    status: health?.status ?? "unknown",
    lastSeenPing: health?.last_seen_ping ?? null,
    lastCheckedAt: health?.last_checked_at ?? null,
    reason: health?.reason ?? null,
  });
});

app.get("/ping", async (c: any) => {
  const db = c.env.PING_DB;
  await assertSchema(db);

  const response = await renderNodeJson(db);

  return c.json(response);
});

app.get("/nodes", async (c: any) => {
  const db = c.env.PING_DB;
  await assertSchema(db);

  const response = await renderNodeJson(db);
  return c.json(response);
});

app.post("/ping", async (c: any) => {
  const db = c.env.PING_DB;
  await assertSchema(db);

  const payload = await c.req.json().catch(() => null);
  if (!isObject(payload)) {
    return c.json({ error: "Invalid payload" }, 400);
  }

  const target = toText(payload.target) ?? toText(payload.host) ?? null;
  const note = toText(payload.note);
  const sourceMeta = parseSourceMetaFromBody(payload);

  const summary = parseSummaryFromBody(payload);

  if (!summary) {
    return c.json({ error: "summary is required" }, 400);
  }

  if (!isValidSummary(summary)) {
    return c.json({ error: "summary has invalid numeric values" }, 400);
  }

  const finalTarget = summary.target || target || "unknown";
  const source = sourceMeta?.hostname ?? UNKNOWN_HOSTNAME;

  const rowId = await insertPingRecord(db, {
    target: finalTarget,
    summary: {
      ...summary,
      target: finalTarget,
    },
    source,
    timeoutMs: null,
    note,
    sourceMeta,
  });

  const now = Date.now();
  const networkStatus: "up" | "down" =
    summary.packetLossPercent >= 100 ? "down" : "up";
  const healthReason =
    summary.packetLossPercent >= 100
      ? "ping lost all packets"
      : "post received";

  await upsertHealth(db, networkStatus, now, now, healthReason);

  return c.json({
    ok: true,
    id: rowId,
    target: finalTarget,
    source,
    recordedAt: now,
    summary,
    sourceMeta,
  });
});

async function checkNetworkHealth(env: CloudflareBindings): Promise<void> {
  const db = env.PING_DB;
  await assertSchema(db);

  const now = Date.now();
  const lastPingAt = await getLatestApiPingAt(db);
  const lastPacketLoss = await getLatestApiPingPacketLoss(db);
  const isDown = !lastPingAt || now - lastPingAt >= STALE_WINDOW_MS;

  const currentHealth = await getCurrentHealth(db);
  if (isDown) {
    const shouldRecordDown = currentHealth?.status !== "down";
    await upsertHealth(
      db,
      "down",
      lastPingAt,
      now,
      lastPingAt ? "No /ping since 75 seconds" : "No /ping records yet",
    );

    if (shouldRecordDown) {
      await insertPingRecord(db, {
        target: "__cron__",
        summary: fallbackTimeoutSummary("__cron__"),
        source: "__cron__",
        timeoutMs: STALE_WINDOW_MS,
        note: "Network deemed down (no POST /ping within 75s)",
        sourceMeta: null,
      });
    }

    return;
  }

  const latestApiDown = lastPacketLoss !== null && lastPacketLoss >= 100;
  const statusFromPing: "up" | "down" = latestApiDown ? "down" : "up";
  const reasonFromPing = latestApiDown ? "Latest /ping report shows full packet loss" : "Ping received from API";

  if (currentHealth?.status !== statusFromPing) {
    await upsertHealth(db, statusFromPing, lastPingAt, now, reasonFromPing);
  }
}

const worker = {
  fetch: app.fetch,
  scheduled: async (_: unknown, env: CloudflareBindings) => {
    await checkNetworkHealth(env);
  },
};

export default worker;
