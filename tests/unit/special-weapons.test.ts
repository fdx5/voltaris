import { describe, it, expect } from 'vitest';
import { GameState, type Weapon } from '../../src/game/GameState';
import {
  specialStats,
  whipPoint,
  WHIP_PATTERN_SECONDS,
  WHIP_SEGMENTS,
} from '../../src/game/SpecialWeapons';
import weapons from '../../data/weapons/weapon-levels.json';

function game(weapon: Weapon = 'LASER', stage = 0) {
  const g = new GameState();
  g.start(weapon, 9, false, false, stage);
  g.level = 4;
  g.invincible = 100;
  return g;
}
function pickup(g: GameState, type: number) {
  g.items.acquire(g.x, g.y, 0, 0, type, 15, 0.5);
  g.tick(1 / 60);
}
describe('stage pickup weapons', () => {
  it('starts at one, upgrades to eight, switches and restores default after destruction', () => {
    const g = game();
    pickup(g, 4);
    expect(g.specialWeapon).toBe('PLASMA');
    expect(g.specialLevel).toBe(1);
    for (let i = 0; i < 10; i++) pickup(g, 0);
    expect(g.specialLevel).toBe(8);
    expect(g.level).toBe(4);
    pickup(g, 5);
    expect(g.specialWeapon).toBe('CRESCENT');
    expect(g.specialLevel).toBe(8);
    pickup(g, 5);
    expect(g.specialLevel).toBe(8);
    pickup(g, 4);
    expect(g.specialLevel).toBe(8);
    pickup(g, 5);
    g.shield = 1;
    g.invincible = 0;
    g.hit();
    expect(g.specialWeapon).toBe('CRESCENT');
    g.invincible = 0;
    g.hit();
    expect(g.specialWeapon).toBeNull();
    expect(g.specialLevel).toBe(1);
  });
  it('preserves the special weapon in the next stage loadout', () => {
    const g = game();
    pickup(g, 4);
    pickup(g, 4);
    // Stage completion records the actual loadout for server replay and carry.
    (g as unknown as { finish(defeated: boolean): void }).finish(true);
    for (let n = 0; n < 421; n++) g.tick(1 / 60);
    expect(g.loadout.specialWeapon).toBe('PLASMA');
    g.start('LASER', 9, false, true, 1);
    expect(g.specialWeapon).toBe('PLASMA');
    expect(g.specialLevel).toBe(2);
  });
  for (const weapon of ['LASER', 'MISSILE', 'SPREAD'] as Weapon[]) {
    it(`${weapon} keeps option projectiles and doubles max main DPS`, () => {
      const g = game(weapon);
      pickup(g, 5);
      g.specialLevel = 8;
      g.bullets.clear();
      g.fireTimer = 0;
      g.tick(1 / 60);
      const active = Array.from({ length: g.bullets.limit }, (_, i) => i).filter(
        (i) => g.bullets.active[i],
      );
      expect(active.some((i) => g.bullets.option[i] === 1)).toBe(true);
      expect(
        active
          .filter((i) => !g.bullets.option[i] && g.bullets.type[i] !== 1)
          .every((i) => g.bullets.type[i] === 6),
      ).toBe(true);
      const w = weapons[weapon][7],
        divisor = weapon === 'MISSILE' ? 3 : weapon === 'SPREAD' ? 2 : 1;
      expect(specialStats(weapon, 8).dps).toBeCloseTo((w.rate / divisor) * w.count * w.damage * 4);
    });
  }
  for (const level of [1, 3, 5, 8]) {
    it(`level ${level} streams complete crescent volleys without burst pauses`, () => {
      const g = game();
      pickup(g, 5);
      g.specialLevel = level;
      const frames: number[] = [],
        angles: number[] = [];
      const stats = specialStats(g.weapon, level);
      let damage = 0;
      for (let n = 0; n < 120; n++) {
        g.bullets.clear();
        g.enemies.clear();
        g.tick(1 / 60);
        let count = 0;
        for (let i = 0; i < g.bullets.limit; i++) {
          if (!g.bullets.active[i] || g.bullets.type[i] !== 6) continue;
          count++;
          damage += g.bullets.hp[i];
          if (!frames.length) angles.push(Math.atan2(g.bullets.vy[i], g.bullets.vx[i]));
        }
        if (count) {
          expect(count).toBe(stats.count);
          frames.push(n);
        }
      }
      expect(frames.length).toBeGreaterThanOrEqual(Math.floor(stats.rate * 2));
      for (let n = 1; n < frames.length; n++)
        expect(frames[n] - frames[n - 1]).toBeLessThanOrEqual(4);
      expect(Math.abs(damage - stats.dps * 1.5 * 2)).toBeLessThanOrEqual(
        (stats.dps * 1.5) / stats.rate + 0.001,
      );
      expect(Math.max(...angles) - Math.min(...angles)).toBeCloseTo(stats.spread * 2);
    });
  }
  it('keeps every intermediate upgrade level when switching in either direction', () => {
    const g = game();
    pickup(g, 4);
    for (let level = 1; level <= 8; level++) {
      g.specialLevel = level;
      pickup(g, 5);
      expect(g.specialLevel).toBe(level);
      pickup(g, 4);
      expect(g.specialLevel).toBe(level);
    }
  });
  it('continues past targets to the edge, and can hit distant visible enemies', () => {
    const g = game();
    pickup(g, 4);
    const i = g.enemies.acquire(15, 2, 0, 0, 0, 100, 0.8, 1000);
    const hp = g.enemies.hp[i];
    for (let n = 0; n < 50; n++) g.tick(1 / 60);
    expect(g.enemies.hp[i]).toBeLessThan(hp);
    expect(g.whipX[WHIP_SEGMENTS]).toBeCloseTo(23 * g.worldScale);
    expect(g.whipX[WHIP_SEGMENTS]).toBeGreaterThan(g.whipTargetX);
  });
  it('returns to a straight full-length beam after targets disappear', () => {
    const g = game();
    pickup(g, 4);
    for (let n = 0; n < 60; n++) {
      g.enemies.clear();
      g.tick(1 / 60);
    }
    expect(g.whipTracking).toBeCloseTo(0, 5);
    expect(Math.max(...g.whipY) - Math.min(...g.whipY)).toBeLessThan(0.001);
  });
  it('has eight smoothly joined lashes, pinned to target, at twice the original thickness', () => {
    expect(specialStats('LASER', 1).width).toBeCloseTo(0.18);
    expect(specialStats('LASER', 8).width).toBeCloseTo(0.67);
    const signatures = new Set<string>();
    for (let pattern = 0; pattern < 8; pattern++) {
      const time = pattern * WHIP_PATTERN_SECONDS;
      const targetT = (5 - (-7 + 0.7)) / (23 - (-7 + 0.7));
      expect(whipPoint(-7, 0, time, targetT, 5, 3).y).toBeCloseTo(3);
      const points = Array.from({ length: 193 }, (_, i) => whipPoint(-7, 0, time, i / 192, 5, 3));
      signatures.add(points.map((p) => p.y.toFixed(2)).join(','));
      for (let i = 1; i < points.length; i++) {
        expect(Number.isFinite(points[i].y)).toBe(true);
        expect(Math.abs(points[i].y - points[i - 1].y)).toBeLessThan(0.8);
        const before = whipPoint(-7, 0, Math.max(0, time - 0.0001), i / 192, 5, 3);
        const after = whipPoint(-7, 0, time + 0.0001, i / 192, 5, 3);
        expect(Math.abs(before.y - after.y)).toBeLessThan(0.01);
      }
    }
    expect(signatures.size).toBe(8);
  });
  it('homes the whip toward an off-axis enemy and deals continuous damage', () => {
    const g = game();
    pickup(g, 4);
    const i = g.enemies.acquire(1, 3, 0, 0, 0, 100, 0.8, 1000);
    const hp = g.enemies.hp[i];
    for (let n = 0; n < 40; n++) g.tick(1 / 60);
    expect(g.whipTargetY).toBeGreaterThan(1);
    expect(g.enemies.hp[i]).toBeLessThan(hp);
    expect(g.whipActive).toBe(true);
  });
  for (let stage = 0; stage < 5; stage++) {
    it(`stage ${stage + 1}: requires power-item level four and offers both capsules`, () => {
      const g = game('LASER', stage);
      const update = (g as unknown as { updateItems(dt: number): void }).updateItems.bind(g);
      g.level = 3;
      update(9);
      expect(g.items.count).toBe(0);
      g.level = 4;
      const types = new Set<number>();
      for (let n = 0; n < 120; n++) {
        update(1);
        for (let i = 0; i < g.items.limit; i++) if (g.items.active[i]) types.add(g.items.type[i]);
      }
      expect(types.has(4)).toBe(true);
      expect(types.has(5)).toBe(true);
    });
  }
  it('does not attract optional capsules or penalize passing them', () => {
    const g = game();
    const i = g.items.acquire(g.x + 3, g.y, 0, 0, 4, 15, 0.5);
    const x = g.items.x[i];
    g.tick(1 / 60);
    expect(g.items.x[i]).toBe(x);
    g.score = 1234;
    g.items.age[i] = 16;
    g.tick(1 / 60);
    expect(g.score).toBe(1234);
  });
});
