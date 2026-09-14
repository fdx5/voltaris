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
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.batch(
    sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean),
    'write',
  );
  const stages = await Promise.all(
    [1, 2, 3, 4].map(async (id) => {
      const stage = JSON.parse(
        await readFile(new URL(`../data/stages/stage-0${id}.json`, import.meta.url), 'utf8'),
      );
      return {
        sql: 'INSERT INTO stages(id,name,planet) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, planet=excluded.planet',
        args: [id, stage.name, ['Earth', 'Mars', 'Jupiter', 'Neptune'][id - 1]],
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
  while (unlockedStage < 4 && cleared.includes(unlockedStage)) unlockedStage++;
  return { id: user.id, username: user.username, clearedStages: cleared, unlockedStage };
}
