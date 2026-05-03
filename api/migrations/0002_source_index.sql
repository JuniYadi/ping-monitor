CREATE INDEX IF NOT EXISTS idx_ping_records_source_recorded_at
  ON ping_records(source, recorded_at);
