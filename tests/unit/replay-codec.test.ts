import { expect, it } from 'vitest';
import { MAX_REPLAY_FRAMES, packReplay, unpackReplay } from '../../src/core/replayCodec';
import { verifyReplay } from '../../server/replay';

const config = { weapon: 'LASER' as const, credits: 3, stage: 1, practice: false, autoFire: true };
it('preserves frame counts, touch inputs and intervening actions losslessly', () => {
  const events = [
    ...Array.from({ length: 600 }, () => [0, 4, 0, 0, 0]),
    [2],
    [1, 0],
    [4, 0],
    [0, 0, 0, 0.1234, -0.05],
    [3],
    ...Array.from({ length: 300 }, () => [0, 8, 2, 0, 0]),
  ];
  const packed = packReplay(events);
  expect(unpackReplay(packed)).toEqual(events);
  expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(events).length / 20);
  expect(verifyReplay(config, packed)).toEqual(verifyReplay(config, events));
});

it('rejects malformed and oversized expanded replays before allocating excessive frames', () => {
  for (const events of [
    [[5, 0, 0, 0, 0, 0]],
    [[5, 2.5, 0, 0, 0, 0]],
    [[5, 1e9, 0, 0, 0, 0]],
    [
      [5, MAX_REPLAY_FRAMES, 0, 0, 0, 0],
      [5, MAX_REPLAY_FRAMES, 0, 0, 0, 0],
    ],
    [[5, 2, 0, 0, 0]],
  ])
    expect(() => unpackReplay(events)).toThrow();
  expect(() => verifyReplay(config, [[5, 2, 1024, 0, 0, 0]])).toThrow();
  expect(() => verifyReplay(config, [[5, 2, 0, 0, NaN, 0]])).toThrow();
});

it('verifies a long, mostly-incompressible run past the old 36000-frame cap', () => {
  // Continuous analog movement rarely repeats frame-to-frame, so a genuinely
  // long Section 5 clear barely compresses - regression test for the replay
  // budget once being tuned for a much shorter maximum session.
  const events = Array.from({ length: 50000 }, (_, i) => [
    0,
    0,
    0,
    Math.sin(i / 37) * 1.5,
    Math.cos(i / 53) * 1.2,
  ]);
  const packed = packReplay(events);
  expect(packed.length).toBeGreaterThan(36000);
  expect(() =>
    verifyReplay({ weapon: 'SPREAD', credits: 15, practice: false, stage: 5, autoFire: true }, packed),
  ).not.toThrow();
});
