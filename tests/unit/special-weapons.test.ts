import { describe, it, expect } from 'vitest';
import { GameState, type Weapon } from '../../src/game/GameState';
import { specialStats } from '../../src/game/SpecialWeapons';
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
    expect(g.specialLevel).toBe(1);
    pickup(g, 5);
    expect(g.specialLevel).toBe(2);
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
  it('fires four crescents at separate times in a max-level burst', () => {
    const g = game();
    pickup(g, 5);
    g.specialLevel = 8;
    const counts: number[] = [];
    for (let n = 0; n < 24; n++) {
      g.bullets.clear();
      g.tick(1 / 60);
      for (let i = 0; i < g.bullets.limit; i++)
        if (g.bullets.active[i] && g.bullets.type[i] === 6) counts.push(n);
    }
    expect(counts).toHaveLength(4);
    expect(new Set(counts).size).toBe(4);
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
