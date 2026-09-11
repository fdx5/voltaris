import { describe, it, expect } from 'vitest';
import { GameState } from '../../src/game/GameState';
import { Terrain } from '../../src/core/math/Terrain';
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

  it('flares the deck and the vault out of frame behind the play plane', () => {
    const game = new GameState();
    game.start('LASER', 3, false, false, 3);
    const { terrain, roof, stage } = game;
    const cfg = stage.surface!;
    const parallel = new Terrain(cfg.span, cfg.base, cfg.relief, cfg.seed);
    // The camera sits at lane height and the frame is 18 units tall at the
    // play plane, so a point is this far up the frame where 1 is the top.
    const eye = 9 / Math.tan(Math.PI / 12);
    const frame = (y: number, z: number) => y / ((eye - z) * Math.tan(Math.PI / 12));
    // In front of the plane, and on it, nothing has moved: the near strip
    // still runs off the frame and emplacements sit where they always did.
    for (let x = 0; x < 120; x += 0.5)
      for (const z of [0, 11, 22])
        expect(terrain!.height(x, z)).toBeCloseTo(parallel.height(x, z), 8);
    // The share of the frame a strip covers: how far its silhouette reaches
    // from the edge it hangs off, over everything the camera can see of it.
    const share = (field: Terrain, far: number, overhead: boolean) => {
      let reach = overhead ? 1 : -1;
      for (let x = 0; x < 120; x += 0.5)
        for (let z = cfg.near; z >= far; z -= 0.25) {
          const at = frame(field.height(x, z), z);
          if (Math.abs(at) > 1) continue;
          reach = overhead ? Math.min(reach, at) : Math.max(reach, at);
        }
      return (overhead ? 1 - reach : reach + 1) / 2;
    };
    const vault = (flare: number) =>
      new Terrain(
        cfg.span,
        cfg.roof!.base,
        -cfg.roof!.relief,
        cfg.roof!.seed,
        cfg.roof!.lane,
        cfg.roof!.reach,
        cfg.roof!.depthSlope,
        flare,
      );
    // Parallel surfaces run on to the horizon and take three fifths of the
    // frame between them. Flared, they leave the corridor almost twice as
    // tall: the deck alone gives back a fifth of the screen.
    const walled = share(parallel, cfg.far, false) + share(vault(0), cfg.roof!.far, true);
    const open = share(terrain!, cfg.far, false) + share(roof!, cfg.roof!.far, true);
    expect(walled).toBeGreaterThan(0.55);
    expect(open).toBeLessThan(walled * 0.6);
    expect(share(terrain!, cfg.far, false)).toBeLessThan(share(parallel, cfg.far, false) * 0.55);
  });
});
