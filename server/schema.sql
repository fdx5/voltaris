CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 4),
  name TEXT NOT NULL,
  planet TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS game_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  practice INTEGER NOT NULL DEFAULT 0 CHECK(practice IN (0,1)),
  weapon TEXT NOT NULL CHECK(weapon IN ('LASER','MISSILE','SPREAD')),
  credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 9),
  config_json TEXT NOT NULL,
  game_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','clear','gameover','abandoned')),
  score INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  seconds REAL NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  credits_used INTEGER NOT NULL DEFAULT 1,
  loadout_json TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS runs_recent ON game_runs(started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS runs_user_recent ON game_runs(user_id, started_at DESC);
CREATE TABLE IF NOT EXISTS stage_progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  first_run_id TEXT NOT NULL REFERENCES game_runs(id),
  cleared_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,stage_id)
);
INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
