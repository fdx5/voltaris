import { parentPort } from 'node:worker_threads';
import { verifyReplay } from './.generated/replay.mjs';
parentPort.on('message', ({ config, events }) => {
  try {
    parentPort.postMessage({ result: verifyReplay(config, events) });
  } catch {
    parentPort.postMessage({ error: '플레이 기록을 검증할 수 없습니다.' });
  }
});
