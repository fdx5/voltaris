import { describe, expect, it } from 'vitest';
import { GameState } from '../../src/game/GameState';
import { groundMuzzle, turnGroundGun } from '../../src/game/GroundAim';
import mounts from '../../data/enemies/ground-hardpoints.json';
import { Shot } from '../../src/game/entities/BulletPool';

describe('articulated surface guns', () => {
  it('turns through the short arc across the angle boundary without overshoot', () => {
    const angle = turnGroundGun(Math.PI - 0.03, -Math.PI + 0.03, 1 / 60);
    expect(Math.abs(Math.sin(angle - (-Math.PI + 0.03)))).toBeLessThan(1e-8);
    expect(turnGroundGun(0, 2, 0.01)).toBeCloseTo(0.05);
  });
  it.each([false, true])('fires every battery from its rotated barrel tip (roof=%s)', (roof) => {
    const game = new GameState();
    game.start('LASER', 3, false, false, roof ? 3 : 2);
    game.autoFire = false;
    const launch = game as unknown as { launchSalvoShot: (...args: (number | string)[]) => void };
    for (let type = 0; type < mounts.length; type++) {
      const y = game.surfaceAt(0, roof);
      const i = game.ground.acquire(0, y, 0, 0, type, 100, 0.8, 100);
      game.ground.aux[i] = roof ? 1 : 0;
      const angle = roof ? -2.1 : 2.1;
      // Legacy fan offsets must not detach bullets from the barrel.
      launch.launchSalvoShot(
        0,
        0.7,
        0.4,
        angle,
        1,
        Shot.ORB,
        'ground',
        i,
        game.ground.generation[i],
        6,
        0,
      );
      const shot = Array.from(game.bullets.active.keys()).find((j) => game.bullets.active[j])!;
      const tip = groundMuzzle(type, angle, roof);
      expect(game.bullets.x[shot]).toBeCloseTo(tip.x, 5);
      expect(game.bullets.y[shot]).toBeCloseTo(y + tip.y, 5);
      expect(Math.atan2(game.bullets.vy[shot], game.bullets.vx[shot])).toBeCloseTo(
        game.groundAim[i],
        5,
      );
      expect(game.groundShot[i]).toBeCloseTo(0.14);
      expect(Math.hypot(tip.x, tip.y - mounts[type].pivot[1] * (roof ? -1 : 1))).toBeCloseTo(
        mounts[type].length,
      );
      game.bullets.clear();
      // Queued shots belonging to a destroyed/reused slot cannot emit a flash.
      const generation = game.ground.generation[i];
      game.ground.release(i);
      launch.launchSalvoShot(0, 0, 0, angle, 1, Shot.ORB, 'ground', i, generation, 6, 0);
      expect(game.bullets.count).toBe(0);
    }
    game.start('LASER', 3, false, false, roof ? 3 : 2);
    expect([...game.groundShot].every((v) => v === 0)).toBe(true);
  });
});
