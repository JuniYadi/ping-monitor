CREATE TABLE IF NOT EXISTS ping_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  transmitted INTEGER NOT NULL DEFAULT 0,
  received INTEGER NOT NULL DEFAULT 0,
  packet_loss_percent REAL NOT NULL DEFAULT 100,
  min_ms REAL,
  avg_ms REAL,
  max_ms REAL,
  stddev_ms REAL,
  source TEXT NOT NULL DEFAULT 'api',
  timeout_ms INTEGER,
  note TEXT,
  source_meta TEXT
);

CREATE TABLE IF NOT EXISTS network_health (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,
  last_seen_ping INTEGER,
  last_checked_at INTEGER NOT NULL,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_ping_records_source_recorded_at
  ON ping_records(source, recorded_at);
