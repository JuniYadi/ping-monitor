CREATE TABLE IF NOT EXISTS node_health (
  node_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_seen_ping INTEGER,
  last_checked_at INTEGER NOT NULL,
  status_since INTEGER,
  reason TEXT
);
