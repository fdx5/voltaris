import 'dotenv/config';
import { createClient } from '@libsql/client';
import { mkdir, readFile } from 'node:fs/promises';

export async function connectDb() {
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.TURSO_DATABASE_URL?.startsWith('libsql://') || !process.env.TURSO_AUTH_TOKEN)
  )
    throw new Error('Production requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.');
  await mkdir('.local', { recursive: true });
  return createClient({
    url: process.env.TURSO_DATABASE_URL || 'file:.local/voltaris.db',
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
}

export async function migrate(db) {
  // A database created before Section 5 has `stages.id CHECK(id BETWEEN 1
  // AND 4)` baked in - `CREATE TABLE IF NOT EXISTS` below is a no-op against
  // an existing table, so widening the CHECK needs SQLite's recreate-in-place
  // dance, run first, before that no-op would otherwise skip past it.
  // Existing rows and every game_runs/stage_progress row referencing
  // stages(id) survive - the table is recreated under its original name.
  const existing = await db.execute(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='stages'",
  );
  const ddl = existing.rows[0]?.sql;
  if (typeof ddl === 'string' && ddl.includes('BETWEEN 1 AND 4')) {
    // `db.batch()` always opens its own transaction before running any
    // statement, and SQLite refuses to change `foreign_keys` inside one, so
    // the toggle has to go through `executeMultiple` (one script, one
    // connection, no implicit transaction) instead. Renaming `stages` away
    // makes SQLite auto-rewrite game_runs/stage_progress's FK clause to
    // point at the new name, so the later DROP fails as a "constraint still
    // referenced" error unless enforcement is off for the whole script.
    await db.executeMultiple(`
      PRAGMA foreign_keys=OFF;
      BEGIN IMMEDIATE;
      ALTER TABLE stages RENAME TO stages_pre_section5;
      CREATE TABLE stages (id INTEGER PRIMARY KEY CHECK(id >= 1), name TEXT NOT NULL, planet TEXT NOT NULL);
      INSERT INTO stages SELECT * FROM stages_pre_section5;
      DROP TABLE stages_pre_section5;
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
  }
  // The rename above (`stages` -> `stages_pre_section5`) also silently
  // rewrote every OTHER table's FK clause that pointed at `stages` - SQLite
  // auto-updates a referencing table's foreign-key text to follow a renamed
  // target. game_runs.stage_id and stage_progress.stage_id ended up
  // permanently pointing at the since-dropped `stages_pre_section5`, so
  // every new game_runs insert failed with "no such table:
  // main.stages_pre_section5" - this is what actually broke launching a
  // game in production. `PRAGMA foreign_keys=OFF` only suppresses live
  // constraint *enforcement*; it does nothing to stop this auto-rewrite, so
  // the only fix is to recreate both tables with the FK clause corrected,
  // in dependency order (stage_progress.first_run_id references
  // game_runs(id), so game_runs must be rebuilt and back under its real
  // name before stage_progress's rename can safely follow it there).
  const [gameRunsDdl, stageProgressDdl] = await Promise.all(
    ['game_runs', 'stage_progress'].map(async (name) => {
      const row = await db.execute({
        sql: "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
        args: [name],
      });
      return row.rows[0]?.sql;
    }),
  );
  if (
    (typeof gameRunsDdl === 'string' && gameRunsDdl.includes('stages_pre_section5')) ||
    (typeof stageProgressDdl === 'string' && stageProgressDdl.includes('stages_pre_section5'))
  ) {
    await db.executeMultiple(`
      PRAGMA foreign_keys=OFF;
      BEGIN IMMEDIATE;
      CREATE TABLE game_runs_fixed (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        stage_id INTEGER NOT NULL REFERENCES stages(id),
        practice INTEGER NOT NULL DEFAULT 0 CHECK(practice IN (0,1)),
        weapon TEXT NOT NULL CHECK(weapon IN ('LASER','MISSILE','SPREAD')),
        credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 15),
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
      INSERT INTO game_runs_fixed SELECT * FROM game_runs;
      CREATE TABLE stage_progress_fixed (
        user_id TEXT NOT NULL REFERENCES users(id),
        stage_id INTEGER NOT NULL REFERENCES stages(id),
        first_run_id TEXT NOT NULL REFERENCES game_runs_fixed(id),
        cleared_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id,stage_id)
      );
      INSERT INTO stage_progress_fixed SELECT * FROM stage_progress;
      DROP TABLE stage_progress;
      DROP TABLE game_runs;
      ALTER TABLE game_runs_fixed RENAME TO game_runs;
      ALTER TABLE stage_progress_fixed RENAME TO stage_progress;
      CREATE INDEX IF NOT EXISTS runs_recent ON game_runs(started_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS runs_user_recent ON game_runs(user_id, started_at DESC);
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
  }
  // Same recreate-in-dependency-order dance as above, this time for widening
  // credits' cap from 9 to 15 - CHECK(credits BETWEEN 1 AND 9) is baked into
  // an existing game_runs table the same way stages.id's old CHECK was, and
  // game_runs has its own incoming FK (stage_progress.first_run_id), so a
  // bare rename would trip the exact same auto-rewrite trap fixed above.
  const gameRunsDdlNow =
    gameRunsDdl ??
    (
      await db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='game_runs'")
    ).rows[0]?.sql;
  if (typeof gameRunsDdlNow === 'string' && gameRunsDdlNow.includes('credits BETWEEN 1 AND 9')) {
    await db.executeMultiple(`
      PRAGMA foreign_keys=OFF;
      BEGIN IMMEDIATE;
      CREATE TABLE game_runs_v2 (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        stage_id INTEGER NOT NULL REFERENCES stages(id),
        practice INTEGER NOT NULL DEFAULT 0 CHECK(practice IN (0,1)),
        weapon TEXT NOT NULL CHECK(weapon IN ('LASER','MISSILE','SPREAD')),
        credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 15),
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
      INSERT INTO game_runs_v2 SELECT * FROM game_runs;
      CREATE TABLE stage_progress_v2 (
        user_id TEXT NOT NULL REFERENCES users(id),
        stage_id INTEGER NOT NULL REFERENCES stages(id),
        first_run_id TEXT NOT NULL REFERENCES game_runs_v2(id),
        cleared_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id,stage_id)
      );
      INSERT INTO stage_progress_v2 SELECT * FROM stage_progress;
      DROP TABLE stage_progress;
      DROP TABLE game_runs;
      ALTER TABLE game_runs_v2 RENAME TO game_runs;
      ALTER TABLE stage_progress_v2 RENAME TO stage_progress;
      CREATE INDEX IF NOT EXISTS runs_recent ON game_runs(started_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS runs_user_recent ON game_runs(user_id, started_at DESC);
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
  }
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.batch(
    sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean),
    'write',
  );
  const stages = await Promise.all(
    [1, 2, 3, 4, 5].map(async (id) => {
      const stage = JSON.parse(
        await readFile(new URL(`../data/stages/stage-0${id}.json`, import.meta.url), 'utf8'),
      );
      return {
        sql: 'INSERT INTO stages(id,name,planet) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, planet=excluded.planet',
        args: [id, stage.name, ['Earth', 'Mars', 'Jupiter', 'Neptune', 'Milky Way'][id - 1]],
      };
    }),
  );
  await db.batch(stages, 'write');
  await db.execute({ sql: 'DELETE FROM sessions WHERE expires_at < ?', args: [Date.now()] });
}

export async function userState(db, id) {
  return userFromRows((await db.execute(userStateQuery(id))).rows);
}

export const userStateQuery = (id) => ({
  sql: 'SELECT u.id,u.username,p.stage_id FROM users u LEFT JOIN stage_progress p ON p.user_id=u.id WHERE u.id=? ORDER BY p.stage_id',
  args: [id],
});

export function userFromRows(rows) {
  const user = rows[0];
  if (!user) return null;
  const cleared = rows.filter((r) => r.stage_id !== null).map((r) => Number(r.stage_id));
  let unlockedStage = 1;
  while (unlockedStage < 5 && cleared.includes(unlockedStage)) unlockedStage++;
  return { id: user.id, username: user.username, clearedStages: cleared, unlockedStage };
}
