import { describe, expect, it } from 'vitest';
import { GameState } from '../../src/game/GameState';
import { formationPosition } from '../../src/game/formations';
import { STAGES } from '../../src/game/stages';
import defs from '../../data/enemies/enemy-defs.json';
import {
  enemyGeometry,
  groundGeometry,
  makeBoss,
  makeShip,
  ENEMY_CORE,
} from '../../src/visual/SceneBuilder';
import { Mesh } from 'three/webgpu';

describe('fleet refit', () => {
  it('keeps off-centre charge lamps attached when hulls are rebuilt', () => {
    for (let i = 0; i < defs.length; i++) {
      const first = enemyGeometry(i);
      const anchor = { ...ENEMY_CORE[i] };
      const second = enemyGeometry(i);
      expect(ENEMY_CORE[i]).toEqual(anchor);
      second.hull!.computeBoundingBox();
      const box = second.hull!.boundingBox!;
      expect(anchor.x).toBeGreaterThanOrEqual(box.min.x);
      expect(anchor.x).toBeLessThanOrEqual(box.max.x);
      expect(anchor.y).toBeGreaterThanOrEqual(box.min.y);
      expect(anchor.y).toBeLessThanOrEqual(box.max.y);
      for (const g of [first, second]) {
        g.hull!.dispose();
        g.accent!.dispose();
      }
    }
  });
  it('supports all eight Jove pods with finite positions and integrity', () => {
    const g = new GameState();
    g.start('LASER', 3, true, false, 2);
    g.tick(1 / 60);
    expect(g.bossParts).toBe(8);
    for (let i = 0; i < g.bossParts; i++) {
      expect(g.partHp[i]).toBeGreaterThan(0);
      expect(Number.isFinite(g.partX[i]) && Number.isFinite(g.partY[i])).toBe(true);
    }
  });
  it('builds valid indexed attributes for every enemy and ground unit', () => {
    for (const geometry of [
      ...defs.map((_, i) => enemyGeometry(i)),
      ...Array.from({ length: 4 }, (_, i) => groundGeometry(i)),
    ]) {
      for (const part of [geometry.hull!, geometry.accent!]) {
        expect(part.attributes.color.count).toBe(part.attributes.position.count);
        expect([...part.attributes.position.array].every(Number.isFinite)).toBe(true);
        part.computeBoundingSphere();
        expect(part.boundingSphere!.radius).toBeGreaterThan(0);
        part.dispose();
      }
    }
  });
  it('builds the player and all destructible boss pod sets', () => {
    const bosses = [makeBoss('gatekeeper'), makeBoss('ares'), makeBoss('jove')];
    expect(bosses.map((b) => b.pods.length)).toEqual([4, 6, 8]);
    for (const root of [makeShip(), ...bosses.flatMap((b) => [b.root, ...b.pods])]) {
      root.traverse((object) => {
        if (object instanceof Mesh) {
          expect([...object.geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((m) => m.dispose());
        }
      });
    }
  });
  it('keeps every authored formation within its sector and avoids overlapping hit radii', () => {
    for (const stage of STAGES)
      for (const [ordinal, wave] of stage.spawns.entries()) {
        const radius = defs[wave.type].radius;
        const min = stage.minY + radius + 0.4,
          max = 7.2 - radius - 0.4;
        const positions = Array.from({ length: wave.count }, (_, n) =>
          formationPosition(ordinal, n, wave.count, radius, wave.y, min, max),
        );
        for (const [i, p] of positions.entries()) {
          expect(p.x).toBeGreaterThan(17.4);
          expect(p.y).toBeGreaterThanOrEqual(min - 1e-6);
          expect(p.y).toBeLessThanOrEqual(max + 1e-6);
          for (const q of positions.slice(i + 1))
            expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(radius * 2);
        }
      }
  });
  it('launches the opening squad at distinct heights on the same simulation frame', () => {
    const g = new GameState();
    g.start('LASER', 3);
    for (let f = 0; f < 600 && !g.enemies.count; f++) g.tick(1 / 60);
    const slots = [...g.enemies.active.keys()].filter((i) => g.enemies.active[i]);
    expect(slots.length).toBe(3);
    expect(new Set(slots.map((i) => g.enemies.y[i])).size).toBe(3);
    expect(new Set(slots.map((i) => g.enemies.age[i])).size).toBe(1);
  });
});

describe('three second overdrive', () => {
  it('blocks damage and shield consumption for three seconds, then restores damage', () => {
    const g = new GameState();
    g.start('LASER', 3);
    g.skillUnlocked = true;
    g.charge[0] = 1;
    g.invincible = 0;
    g.shield = 1;
    const lives = g.lives;
    g.activate(0);
    for (let i = 0; i < 179; i++) {
      g.tick(1 / 60);
      g.hit();
    }
    expect(g.lives).toBe(lives);
    expect(g.shield).toBe(1);
    expect(g.effects[0]).toBeGreaterThan(0);
    g.pause();
    g.tick(1);
    expect(g.effects[0]).toBeGreaterThan(0);
    g.pause();
    g.tick(1 / 60);
    g.tick(1 / 60);
    expect(g.effects[0]).toBe(0);
    expect(g.invincible).toBe(0);
    g.hit();
    expect(g.shield).toBe(0);
  });
});
