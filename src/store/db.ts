import Database from 'better-sqlite3'
import { DB_PATH, ensureHomeDirs } from '../paths.ts'

let cached: Database.Database | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  name          TEXT PRIMARY KEY,
  config_hash   TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_run_at   INTEGER,
  next_run_at   INTEGER,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  task_name     TEXT NOT NULL,
  item_key      TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  PRIMARY KEY (task_name, item_key)
);

CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name       TEXT NOT NULL,
  status          TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER NOT NULL,
  new_items_count INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS runs_task_started ON runs(task_name, started_at DESC);

CREATE TABLE IF NOT EXISTS channels (
  name        TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  task_name    TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);
`

export function getDb(): Database.Database {
  if (cached) return cached
  ensureHomeDirs()
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  cached = db
  return db
}

export function closeDb(): void {
  if (cached) {
    cached.close()
    cached = null
  }
}

/** Test-only: drop the cached handle so a new BROWSER_CLI_HOME can be picked up. */
export function __resetDbForTests(): void {
  closeDb()
}
