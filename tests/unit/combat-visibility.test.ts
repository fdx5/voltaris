import { describe, expect, it } from 'vitest';
import { GameState } from '../../src/game/GameState';
import { DestructionEffects } from '../../src/visual/DestructionEffects';
import { InstancedMesh } from 'three/webgpu';

describe('screen entry protection', () => {
  it('protects full model bounds from direct, piercing, plasma and nova damage', () => {
    for (const attack of ['direct', 'projectile', 'plasma', 'nova']) {
      const g = new GameState();
      g.start('LASER', 3);
      g.autoFire = false;
      const i = g.enemies.acquire(15, 0, -2, 0, 0, 20, 1, 100);
      const run = () => {
        if (attack === 'direct') g.damageEnemy(i, 10);
        if (attack === 'projectile') {
          g.bullets.fire(g.enemies.x[i], 0, 0, 0, 6, 1, 10, 9);
          (g as unknown as { collisions(): void }).collisions();
        }
        if (attack === 'plasma') {
          g.specialWeapon = 'PLASMA';
          (
            g as unknown as { updateSpecialWeapon(dt: number, firing: boolean): void }
          ).updateSpecialWeapon(0.1, true);
        }
        if (attack === 'nova') (g as unknown as { detonateNova(): void }).detonateNova();
      };
      run();
      expect(g.enemies.hp[i], attack).toBe(100);
      g.enemies.x[i] = g.enemies.px[i] = 10;
      run();
      expect(g.enemies.hp[i], attack).toBeLessThan(100);
    }
  });
  it('protects ground units and rocks on every edge and follows the vertical camera', () => {
    const g = new GameState();
    g.start('LASER', 3);
    for (const pool of [g.ground, g.rocks]) {
      const i = pool.acquire(17, 0, 0, 0, 0, 20, 1, 100);
      const hit = () => (pool === g.ground ? g.damageGround(i, 10) : g.damageRock(i, 10));
      hit();
      expect(pool.hp[i]).toBe(100);
      pool.x[i] = pool.px[i] = 0;
      pool.y[i] = pool.py[i] = 9;
      hit();
      expect(pool.hp[i]).toBe(100);
      pool.y[i] = pool.py[i] = 0;
      hit();
      expect(pool.hp[i]).toBe(90);
    }
    g.start('LASER', 3, false, false, 4);
    g.y = 20;
    const i = g.enemies.acquire(0, -40, 0, 0, 0, 20, 1, 100);
    expect(g.canDamage(g.enemies, i)).toBe(false);
    g.enemies.y[i] = g.enemies.py[i] = g.cameraFollowY;
    expect(g.canDamage(g.enemies, i)).toBe(true);
  });
  it.each([0, 1, 2, 3, 4])('stage %i boss enters fully and remains attackable', (stage) => {
    const g = new GameState();
    g.start('LASER', 3, true, false, stage);
    g.autoFire = false;
    g.invincible = 100;
    expect(g.bossVulnerable).toBe(false);
    for (let n = 0; n < 600; n++) g.tick(1 / 60);
    expect(g.bossVulnerable).toBe(true);
    for (let n = 0; n < 360; n++) {
      g.tick(1 / 60);
      expect(g.bossVulnerable).toBe(true);
    }
  });
});

it('bounds detailed destruction batches and expires every effect', () => {
  const g = new GameState();
  const visual = new DestructionEffects();
  for (let n = 0; n < 100; n++) g.destruction.acquire(0, 0, 0, 0, 3, 3.2, 3);
  g.destruction.move(0.5);
  visual.update(g.destruction, 0.5, false, false);
  for (const child of visual.root.children) {
    const mesh = child as InstancedMesh;
    expect(mesh.count).toBeGreaterThan(0);
    expect(mesh.count).toBeLessThanOrEqual(mesh.instanceMatrix.count);
    expect(Array.from(mesh.instanceMatrix.array).every(Number.isFinite)).toBe(true);
  }
  g.destruction.move(3);
  visual.update(g.destruction, 3.5, true, true);
  expect(visual.root.children.every((child) => (child as InstancedMesh).count === 0)).toBe(true);
});
