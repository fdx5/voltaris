import { describe, expect, it } from 'vitest';
import { bossSalvo } from '../../src/game/HostilePatterns';
import { GameState } from '../../src/game/GameState';

describe('capital refit combat contracts', () => {
  it('alternates all twelve boss phases without exceeding the salvo budget', () => {
    for (let stage = 0; stage < 4; stage++) {
      for (let phase = 1; phase <= 3; phase++) {
        const primary = bossSalvo(stage, phase, 1, Math.PI);
        const alternate = bossSalvo(stage, phase, 2, Math.PI);
        expect(alternate).not.toEqual(primary);
        expect(alternate).toEqual(bossSalvo(stage, phase, 2, Math.PI));
        expect(alternate.length).toBeGreaterThan(0);
        expect(alternate.length).toBeLessThanOrEqual(60);
        expect(alternate.every((s) => s.delay <= 1.3 && s.delay >= 0 && s.speed > 0)).toBe(true);
      }
    }
  });
  it('leaves a three-row passage in each alternate Gatekeeper curtain', () => {
    const plan = bossSalvo(0, 3, 2, Math.PI);
    for (let beat = 0; beat < 3; beat++) {
      const rows = plan
        .filter((s) => Math.abs(s.delay - beat * 0.28) < 0.001)
        .map((s) => s.dy / 0.49);
      const centre = 1 - beat;
      expect(rows.every((r) => Math.abs(r - centre) > 1)).toBe(true);
    }
  });
  it('gives scatter shots their own visual identity without changing faction or damage', () => {
    const game = new GameState();
    game.start('SPREAD', 3, false);
    for (let i = 0; i < 10; i++) game.tick(1 / 60);
    const p = game.bullets;
    const shots = Array.from({ length: p.capacity }, (_, i) => i).filter(
      (i) => p.active[i] && p.type[i] === 0,
    );
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((i) => p.tint[i] === 0xbca8ff && p.hp[i] > 0)).toBe(true);
  });
});
