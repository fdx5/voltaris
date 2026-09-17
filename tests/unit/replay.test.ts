import { describe, it, expect } from 'vitest';
import { GameState } from '../../src/game/GameState';
import { verifyReplay } from '../../server/replay';
import { MAX_PACKED_LENGTH } from '../../src/core/replayCodec';
describe('server gameplay replay', () => {
  it('reproduces score, kills and elapsed time from gameplay including skills and autofire changes', () => {
    const g = new GameState();
    g.start('LASER', 3);
    const events: number[][] = [];
    for (let i = 0; i < 2400; i++) {
      if (g.status === 'continue') {
        g.continueRun();
        events.push([3]);
      }
      if (i === 300) {
        g.cycleMode();
        events.push([2]);
      }
      if (i === 600) {
        g.autoFire = false;
        events.push([4, 0]);
      }
      if (i === 900) {
        g.autoFire = true;
        events.push([4, 1]);
        g.activate(0);
        events.push([1, 0]);
      }
      const bits = i % 240 < 120 ? 4 : 8;
      events.push([0, bits, 0, 0, 0]);
      g.tick(1 / 60, bits);
    }
    const result = verifyReplay(
      { weapon: 'LASER', credits: 3, stage: 1, practice: false, autoFire: true },
      events,
    );
    expect(result.score).toBe(Math.floor(g.score));
    expect(result.kills).toBe(g.kills);
    expect(result.seconds).toBe(g.time);
  });
  it('rejects unknown controls, nonfinite values, and excessive replay input', () => {
    const config = {
      weapon: 'LASER' as const,
      credits: 3,
      stage: 1,
      practice: false,
      autoFire: true,
    };
    expect(() => verifyReplay(config, [[9]])).toThrow();
    expect(() => verifyReplay(config, [[0, 0, 0, NaN, 0]])).toThrow();
    expect(() =>
      verifyReplay(
        config,
        Array.from({ length: MAX_PACKED_LENGTH + 1 }, () => [2]),
      ),
    ).toThrow();
  });
});
