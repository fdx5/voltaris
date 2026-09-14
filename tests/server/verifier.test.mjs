import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplayVerifier } from '../../server/verify.mjs';
const config = { stage: 1, weapon: 'LASER', credits: 3, practice: false, autoFire: true };

test('reuses warmed workers, queues simultaneous saves and isolates malformed records', async (t) => {
  const pool = new ReplayVerifier({ size: 1 });
  t.after(() => pool.close());
  const [a, b, invalid, c] = await Promise.allSettled([
    pool.verify(config, []),
    pool.verify(config, [[5, 120, 0, 0, 0, 0]]),
    pool.verify(config, [[9]]),
    pool.verify(config, []),
  ]);
  assert.equal(a.status, 'fulfilled');
  assert.equal(b.status, 'fulfilled');
  assert.equal(b.value.frames, 120);
  assert.equal(invalid.status, 'rejected');
  assert.equal(invalid.reason.status, 422);
  assert.deepEqual(c.value, a.value);
  assert.equal(pool.created, 1);
  assert.equal(pool.pending, 0);
});

test('bounds queued saves and releases timed-out worker capacity', async (t) => {
  const pool = new ReplayVerifier({
    size: 1,
    maxPending: 1,
    timeoutMs: 100,
    workerUrl: new URL(
      'data:text/javascript,import%20%7BparentPort%7D%20from%20%22node%3Aworker_threads%22%3BparentPort.on(%22message%22%2C()%3D%3E%7B%7D)%3B',
    ),
  });
  t.after(() => pool.close());
  const first = assert.rejects(pool.verify(config, []), { status: 503 });
  await assert.rejects(pool.verify(config, []), { status: 503 });
  await first;
  assert.equal(pool.pending, 0);
  assert.equal(pool.workers.size, 0);
  pool.workerUrl = new URL('../../server/replay-worker.mjs', import.meta.url);
  pool.timeoutMs = 5000;
  assert.equal((await pool.verify(config, [])).score, 0);
});

test('worker startup failures reject the request and allow recovery', async (t) => {
  const pool = new ReplayVerifier({ workerUrl: new URL('file:///missing-voltaris-worker.mjs') });
  t.after(() => pool.close());
  await assert.rejects(pool.verify(config, []), { status: 503 });
  assert.equal(pool.pending, 0);
  pool.workerUrl = new URL('../../server/replay-worker.mjs', import.meta.url);
  assert.equal((await pool.verify(config, [])).status, 'abandoned');
});
