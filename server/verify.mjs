import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const gameVersion = createHash('sha256')
  .update(readFileSync(new URL('./.generated/replay.mjs', import.meta.url)))
  .digest('hex')
  .slice(0, 16);
// A prior compatibility bridge for the packed-replay optimization lived here,
// safe only because that change was differential-tested to produce identical
// results to the rules it replaced. A gameplay-affecting change like a
// balance edit must NOT get the same bridge: an in-flight run's recorded
// events would replay against different damage than the player actually
// experienced, so it has to fall through to the 409 "restart" response below
// instead of being silently (and incorrectly) re-scored.
export const canVerifyVersion = (version) => version === gameVersion;
const unavailable = (message) => Object.assign(new Error(message), { status: 503 });

/** Bounded reusable workers retain compiled gameplay code between saves. */
export class ReplayVerifier {
  constructor({
    size = 2,
    maxPending = 10,
    timeoutMs = 30000,
    workerUrl = new URL('./replay-worker.mjs', import.meta.url),
  } = {}) {
    this.size = size;
    this.maxPending = maxPending;
    this.timeoutMs = timeoutMs;
    this.workerUrl = workerUrl;
    this.workers = new Set();
    this.queue = [];
    this.pending = 0;
    this.created = 0;
    this.closed = false;
  }
  verify(config, events) {
    if (this.closed || this.pending >= this.maxPending)
      return Promise.reject(
        unavailable('검증 서버가 사용 중입니다. 잠시 후 저장을 다시 시도하세요.'),
      );
    this.pending++;
    return new Promise((resolve, reject) => {
      const job = { config, events, resolve, reject, slot: null, settled: false };
      job.timer = setTimeout(() => {
        if (job.slot) this.remove(job.slot);
        else this.queue = this.queue.filter((entry) => entry !== job);
        this.finish(job, unavailable('검증 시간 초과. 다시 시도하세요.'));
        this.dispatch();
      }, this.timeoutMs);
      this.queue.push(job);
      this.dispatch();
    });
  }
  finish(job, error, result) {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    this.pending--;
    if (error) job.reject(error);
    else job.resolve(result);
  }
  remove(slot) {
    this.workers.delete(slot);
    void slot.worker.terminate();
  }
  create() {
    const worker = new Worker(this.workerUrl, { resourceLimits: { maxOldGenerationSizeMb: 128 } });
    const slot = { worker, job: null };
    this.workers.add(slot);
    this.created++;
    worker.on('message', (message) => {
      if (!this.workers.has(slot) || !slot.job) return;
      const job = slot.job;
      slot.job = null;
      worker.unref();
      this.finish(
        job,
        message.error ? Object.assign(new Error(message.error), { status: 422 }) : null,
        message.result,
      );
      this.dispatch();
    });
    const failed = () => {
      if (!this.workers.has(slot)) return;
      this.remove(slot);
      if (slot.job) this.finish(slot.job, unavailable('검증 실패. 다시 시도하세요.'));
      this.dispatch();
    };
    worker.on('error', failed);
    worker.on('exit', failed);
    worker.unref();
    return slot;
  }
  dispatch() {
    while (!this.closed && this.queue.length) {
      let slot = [...this.workers].find((entry) => !entry.job);
      if (!slot && this.workers.size >= this.size) return;
      const job = this.queue.shift();
      try {
        slot ??= this.create();
        slot.job = job;
        job.slot = slot;
        slot.worker.ref();
        slot.worker.postMessage({ config: job.config, events: job.events });
      } catch {
        if (slot) this.remove(slot);
        this.finish(job, unavailable('검증 작업을 시작할 수 없습니다. 다시 시도하세요.'));
      }
    }
  }
  close() {
    this.closed = true;
    for (const slot of this.workers) {
      this.remove(slot);
      if (slot.job)
        this.finish(slot.job, unavailable('검증 서버가 종료되었습니다. 다시 시도하세요.'));
    }
    for (const job of this.queue)
      this.finish(job, unavailable('검증 서버가 종료되었습니다. 다시 시도하세요.'));
    this.queue = [];
  }
}
const pool = new ReplayVerifier();
export const verify = (config, events) => pool.verify(config, events);
