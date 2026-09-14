/** Lossless runs of identical input frames; actions retain their exact order. */
export function packReplay(events: readonly number[][]): number[][] {
  const packed: number[][] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    let count = 1;
    if (event.length === 5 && event[0] === 0)
      while (i + count < events.length && count < 36000) {
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
  if (!Array.isArray(events) || events.length > 45000) throw new Error('Invalid replay length');
  const decoded: number[][] = [];
  for (const event of events) {
    if (!Array.isArray(event)) throw new Error('Invalid replay event');
    if (event[0] === 5) {
      const count = event[1];
      if (
        event.length !== 6 ||
        !Number.isInteger(count) ||
        count < 2 ||
        count > 36000 ||
        decoded.length + count > 45000
      )
        throw new Error('Invalid replay run');
      const frame = [0, ...event.slice(2)];
      for (let i = 0; i < count; i++) decoded.push(frame);
    } else {
      if (decoded.length >= 45000) throw new Error('Invalid replay length');
      decoded.push(event);
    }
  }
  return decoded;
}
