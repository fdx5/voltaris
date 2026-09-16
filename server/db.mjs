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
    await db.batch(
      [
        'ALTER TABLE stages RENAME TO stages_pre_section5',
        'CREATE TABLE stages (id INTEGER PRIMARY KEY CHECK(id >= 1), name TEXT NOT NULL, planet TEXT NOT NULL)',
        'INSERT INTO stages SELECT * FROM stages_pre_section5',
        'DROP TABLE stages_pre_section5',
      ],
      'write',
    );
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
