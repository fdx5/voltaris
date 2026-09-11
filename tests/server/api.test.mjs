import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { createApp } from '../../server/app.mjs';
import { migrate } from '../../server/db.mjs';
import { verify } from '../../server/verify.mjs';

async function fixture(t, verifier = verify) {
  const db = createClient({ url: 'file::memory:' });
  await migrate(db);
  const app = await createApp(db, { verifier, rateLimits: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
  });
  const request = async (path, body, cookie = '', extra = {}) => {
    const response = await fetch(base + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Voltaris': '1', cookie, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      headers: response.headers,
    };
  };
  const register = async (username) =>
    request('/auth/register', { username, password: 'correct horse battery 123' });
  return { db, request, register };
}
const config = { stage: 1, weapon: 'LASER', credits: 3, practice: false, autoFire: true };

test('migration seeds four stages idempotently and does not create fake players', async (t) => {
  const { db } = await fixture(t);
  await migrate(db);
  assert.equal((await db.execute('SELECT * FROM stages')).rows.length, 4);
  assert.equal((await db.execute('SELECT * FROM users')).rows.length, 0);
});
test('registration, password hashing, duplicate ID, session restore and logout', async (t) => {
  const { db, request, register } = await fixture(t);
  const user = await register('pilot_one');
  assert.equal(user.status, 201);
  assert.match(user.headers.get('set-cookie'), /HttpOnly/);
  assert.match(user.headers.get('set-cookie'), /SameSite=Strict/);
  const stored = (await db.execute('SELECT password_hash FROM users')).rows[0].password_hash;
  assert.match(stored, /^scrypt:/);
  assert.ok(!stored.includes('correct horse'));
  assert.equal((await register('PILOT_ONE')).status, 409);
  assert.equal(
    (await request('/auth/login', { username: 'pilot_one', password: 'wrong password 123' }))
      .status,
    401,
  );
  const login = await request('/auth/login', {
    username: 'pilot_one',
    password: 'correct horse battery 123',
  });
  assert.equal(login.status, 200);
  assert.equal((await request('/auth/me', undefined, login.cookie)).body.user.unlockedStage, 1);
  await request('/auth/logout', {}, login.cookie);
  assert.equal((await request('/auth/me', undefined, login.cookie)).status, 401);
});
test('accepts a four character password and still rejects a shorter one', async (t) => {
  const { request } = await fixture(t);
  assert.equal(
    (await request('/auth/register', { username: 'short_pw', password: 'ab' })).status,
    400,
  );
  const made = await request('/auth/register', { username: 'short_pw', password: '1234' });
  assert.equal(made.status, 201);
  assert.equal(
    (await request('/auth/login', { username: 'short_pw', password: '1234' })).status,
    200,
  );
  assert.equal(
    (await request('/auth/login', { username: 'short_pw', password: '12345' })).status,
    401,
  );
});
test('auth, expiry, cross-origin protection and locked practice stages are enforced', async (t) => {
  const { db, request, register } = await fixture(t);
  assert.equal((await request('/history')).status, 401);
  const user = await register('lock_pilot');
  assert.equal((await request('/runs', { ...config, stage: 2 }, user.cookie)).status, 403);
  assert.equal(
    (await request('/runs', { ...config, stage: 4, practice: true }, user.cookie)).status,
    403,
  );
  assert.equal(
    (await request('/runs', config, user.cookie, { origin: 'https://attacker.example' })).status,
    403,
  );
  assert.equal((await request('/runs', config, user.cookie, { 'X-Voltaris': '' })).status, 403);
  await db.execute('UPDATE sessions SET expires_at=0');
  assert.equal((await request('/auth/me', undefined, user.cookie)).status, 401);
});
test('a forged client clear and fabricated score cannot unlock a stage', async (t) => {
  const { request, register } = await fixture(t);
  const user = await register('honest_pilot');
  const run = await request('/runs', config, user.cookie);
  assert.equal(
    (
      await request(
        `/runs/${run.body.id}/finish`,
        { events: [], outcome: 'clear', score: 999999 },
        user.cookie,
      )
    ).status,
    422,
  );
  assert.equal((await request('/auth/me', undefined, user.cookie)).body.user.unlockedStage, 1);
  const finish = await request(
    `/runs/${run.body.id}/finish`,
    { events: [], outcome: 'abandoned', score: 999999 },
    user.cookie,
  );
  assert.equal(finish.status, 200);
  const history = await request('/history', undefined, user.cookie);
  assert.equal(history.body.rows[0].score, 0);
  assert.equal(history.body.rows[0].status, 'abandoned');
});
test('verified clears unlock only the owner, persist, save once and support carry loadouts', async (t) => {
  // Isolate the database transaction from gameplay; the real verifier is tested separately.
  const result = {
    status: 'clear',
    score: 4200,
    kills: 30,
    seconds: 220,
    level: 5,
    creditsUsed: 1,
    loadout: { level: 5, optionCount: 2, shield: 1 },
    frames: 13200,
  };
  const { db, request, register } = await fixture(t, async () => result);
  const one = await register('clear_pilot'),
    two = await register('other_pilot');
  const run = await request('/runs', config, one.cookie),
    path = `/runs/${run.body.id}/finish`;
  assert.equal((await request(path, { events: [] }, two.cookie)).status, 404);
  const finish = await request(path, { events: [], outcome: 'clear' }, one.cookie);
  assert.equal(finish.body.user.unlockedStage, 2);
  await request(path, { events: [] }, one.cookie);
  assert.equal((await db.execute('SELECT * FROM stage_progress')).rows.length, 1);
  assert.equal((await request('/auth/me', undefined, two.cookie)).body.user.unlockedStage, 1);
  const next = await request(
    '/runs',
    { ...config, stage: 2, previousRunId: run.body.id },
    one.cookie,
  );
  assert.deepEqual(next.body.config.loadout, result.loadout);
  assert.equal((await request('/runs', { ...config, stage: 3 }, one.cookie)).status, 403);
  const history = await request('/history?username=clear_pilot&stage=1', undefined, two.cookie);
  assert.equal(history.body.total, 1);
  assert.equal(history.body.rows[0].username, 'clear_pilot');
  assert.ok(!JSON.stringify(history.body).includes('password'));
  assert.ok(!JSON.stringify(history.body).includes('token_hash'));
  assert.equal((await request('/history?page=-1', undefined, one.cookie)).status, 400);
});
test('boss training clears never unlock progression', async (t) => {
  const { request, register } = await fixture(t, async () => ({
    status: 'clear',
    score: 10,
    kills: 1,
    seconds: 50,
    level: 6,
    creditsUsed: 1,
    loadout: { level: 6, optionCount: 4, shield: 0 },
  }));
  const user = await register('training_pilot');
  const run = await request('/runs', { ...config, practice: true }, user.cookie);
  const finish = await request(
    `/runs/${run.body.id}/finish`,
    { events: [], outcome: 'clear' },
    user.cookie,
  );
  assert.equal(finish.body.user.unlockedStage, 1);
});
test('malformed replay does not persist a result', async (t) => {
  const { request, register } = await fixture(t);
  const user = await register('invalid_replay');
  const run = await request('/runs', config, user.cookie);
  assert.equal(
    (await request(`/runs/${run.body.id}/finish`, { events: [[0, 0, 0, 100000, 0]] }, user.cookie))
      .status,
    422,
  );
  assert.equal((await request('/history', undefined, user.cookie)).body.rows[0].status, 'started');
});
