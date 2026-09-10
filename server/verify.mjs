import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const gameVersion = createHash('sha256')
  .update(readFileSync(new URL('./.generated/replay.mjs', import.meta.url)))
  .digest('hex')
  .slice(0, 16);
let active = 0;
export function verify(config, events) {
  if (active >= 2)
    return Promise.reject(
      Object.assign(new Error('검증 서버가 사용 중입니다. 잠시 후 저장을 다시 시도하세요.'), {
        status: 503,
      }),
    );
  active++;
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./replay-worker.mjs', import.meta.url), {
      workerData: { config, events },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    let settled = false;
    const done = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active--;
      void worker.terminate();
      if (err) reject(err);
      else resolve(result);
    };
    const timer = setTimeout(
      () => done(Object.assign(new Error('검증 시간 초과. 다시 시도하세요.'), { status: 503 })),
      30000,
    );
    worker.once('message', (m) =>
      done(m.error ? Object.assign(new Error(m.error), { status: 422 }) : null, m.result),
    );
    worker.once('error', () =>
      done(Object.assign(new Error('검증 실패. 다시 시도하세요.'), { status: 503 })),
    );
    worker.once('exit', (code) => {
      if (!settled) done(Object.assign(new Error(`검증 작업 종료 (${code})`), { status: 503 }));
    });
  });
}
