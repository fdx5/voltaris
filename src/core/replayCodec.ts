/**
 * Longest real "playing" time (kind-0 tick frames, ~60/s) a single replay may
 * cover. Tune this alongside stage durations and boss-fight length: a run
 * that legitimately needs more ticks than this to finish gets rejected here
 * (and by `server/replay.ts`'s own frame counter, which shares this constant)
 * with a generic "cannot verify" error. Section 5's two-boss fight can run
 * past 45 minutes (~165k frames) for an ordinary, unhurried clear even
 * without picking up a single upgrade - this leaves real headroom above that
 * observed worst case while keeping verification inside the server's
 * per-job timeout (see `server/verify.mjs`'s `timeoutMs`).
 */
export const MAX_REPLAY_FRAMES = 200000;
/** A handful of non-tick events (skill/mode/continue/autofire) can pad the
 * packed array beyond MAX_REPLAY_FRAMES entries without representing extra
 * play time, so the packed-length budget carries its own small margin. */
export const MAX_PACKED_LENGTH = MAX_REPLAY_FRAMES + 5000;

/** Lossless runs of identical input frames; actions retain their exact order. */
export function packReplay(events: readonly number[][]): number[][] {
  const packed: number[][] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    let count = 1;
    if (event.length === 5 && event[0] === 0)
      while (i + count < events.length && count < MAX_REPLAY_FRAMES) {
        const next = events[i + count];
        if (next.length !== 5 || !event.every((value, k) => value === next[k])) break;
        count++;
      }
    packed.push(count > 1 ? [5, count, ...event.slice(1)] : event);
    i += count - 1;
  }
  return packed;
}

export function unpackReplay(events: number[][]): number[][] {
  if (!Array.isArray(events) || events.length > MAX_PACKED_LENGTH)
    throw new Error('Invalid replay length');
  const decoded: number[][] = [];
  for (const event of events) {
    if (!Array.isArray(event)) throw new Error('Invalid replay event');
    if (event[0] === 5) {
      const count = event[1];
      if (
        event.length !== 6 ||
        !Number.isInteger(count) ||
        count < 2 ||
        count > MAX_REPLAY_FRAMES ||
        decoded.length + count > MAX_PACKED_LENGTH
      )
        throw new Error('Invalid replay run');
      const frame = [0, ...event.slice(2)];
      for (let i = 0; i < count; i++) decoded.push(frame);
    } else {
      if (decoded.length >= MAX_PACKED_LENGTH) throw new Error('Invalid replay length');
      decoded.push(event);
    }
  }
  return decoded;
}
