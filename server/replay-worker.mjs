import { parentPort, workerData } from 'node:worker_threads';
import { verifyReplay } from './.generated/replay.mjs';
try {
  parentPort.postMessage({ result: verifyReplay(workerData.config, workerData.events) });
} catch {
  parentPort.postMessage({ error: '플레이 기록을 검증할 수 없습니다.' });
}
