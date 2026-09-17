import { parentPort } from 'node:worker_threads';
import { verifyReplay } from './.generated/replay.mjs';
parentPort.on('message', ({ config, events }) => {
  try {
    parentPort.postMessage({ result: verifyReplay(config, events) });
  } catch {
    parentPort.postMessage({ error: 'REPLAY_UNVERIFIABLE' });
  }
});
