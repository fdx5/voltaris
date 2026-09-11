import { describe, it, expect } from 'vitest';
import { GameState } from '../../src/game/GameState';
import { STAGES } from '../../src/game/stages';

describe('glacial corridor', () => {
  it('doubles both emplacement banks with sorted, in-stage timings', () => {
    const stage = STAGES[3];
    expect(stage.ground.filter((e) => !e.roof)).toHaveLength(80);
    expect(stage.ground.filter((e) => e.roof)).toHaveLength(78);
    for (let i = 1; i < stage.ground.length; i++) {
      expect(stage.ground[i].time).toBeGreaterThan(stage.ground[i - 1].time);
      expect(stage.ground[i].time).toBeLessThan(stage.durationSec);
    }
  });
  it('keeps an open flight lane through every scrolling terrain tile', () => {
    const game = new GameState();
    game.start('LASER', 3, false, false, 3);
    const { terrain, roof, stage } = game;
    const floorHeights: number[] = [];
    for (let x = 0; x <= 120; x += 0.25) {
      const bottom = terrain!.height(x, 0);
      const top = roof!.height(x, 0);
      expect(bottom).toBeLessThan(stage.minY - 0.4);
      expect(top).toBeGreaterThan(stage.maxY + 0.4);
      floorHeights.push(bottom);
      for (const z of [-26, 0, 22]) {
        expect(terrain!.height(x, z)).toBeCloseTo(terrain!.height(x + 120, z), 8);
        expect(roof!.height(x, z)).toBeCloseTo(roof!.height(x + 120, z), 8);
      }
    }
    expect(Math.max(...floorHeights) - Math.min(...floorHeights)).toBeGreaterThan(0.3);
    expect(stage.surface!.roof!.relief).toBe(1.9 / 2);
  });
});
