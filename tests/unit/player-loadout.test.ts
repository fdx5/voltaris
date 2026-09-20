import { describe, it, expect } from 'vitest';
import { GameState, type Weapon } from '../../src/game/GameState';
import weapons from '../../data/weapons/weapon-levels.json';
import { Key } from '../../src/core/input/InputManager';

describe('player airframe armament', () => {
  for (const weapon of ['LASER', 'MISSILE', 'SPREAD'] as Weapon[]) {
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8]) {
      it(`${weapon} Lv.${level}: main and four options keep the fan and reduced sustained rate`, () => {
        const g = new GameState();
        g.start(weapon, 9);
        g.level = level;
        g.optionCount = 4;
        g.invincible = 100;
        const dt = 1 / 120;
        let main = 0,
          option = 0,
          optionDamage = 0,
          mainCore = 0,
          coreDamage = 0,
          coreRadius = 0;
        for (let frame = 0; frame < 1200; frame++) {
          g.enemies.clear();
          g.bullets.clear();
          g.tick(dt);
          for (let i = 0; i < g.bullets.capacity; i++) {
            if (!g.bullets.active[i] || g.bullets.type[i] === 1) continue;
            if (g.bullets.option[i]) {
              option++;
              optionDamage += g.bullets.hp[i];
            } else if (g.bullets.type[i] === 7) {
              // SPREAD's heavy centre round, fired alongside (not part of) the fan.
              mainCore++;
              coreDamage += g.bullets.hp[i];
              coreRadius = g.bullets.radius[i];
            } else main++;
          }
        }
        const w = weapons[weapon][level - 1];
        const divisor = weapon === 'MISSILE' ? 3 : weapon === 'SPREAD' ? 2 : 1;
        const expected = (10 * w.rate * w.count) / divisor;
        expect(Math.abs(main - expected)).toBeLessThanOrEqual(w.count);
        expect(option).toBe((main / w.count) * Math.ceil(w.count / 2) * 4);
        expect(optionDamage).toBeCloseTo(main * 4 * w.damage, 2);
        expect(g.weapon).toBe(weapon);
        if (weapon === 'SPREAD') {
          // One heavy core round per main-gun volley (never an option's) -
          // twice a fan pellet's width, 1.5x a fan pellet's own damage.
          const volleys = main / w.count;
          expect(mainCore).toBeCloseTo(volleys, 0);
          expect(coreDamage / mainCore).toBeCloseTo(w.damage * 2 * 1.5, 2);
          expect(coreRadius).toBeCloseTo(w.width * 2, 5);
        } else {
          expect(mainCore).toBe(0);
        }
      });
    }
  }
  it('climb and dive bank in opposite directions and settle at side view', () => {
    const g = new GameState();
    g.start('MISSILE', 9);
    for (let i = 0; i < 20; i++) g.tick(1 / 60, Key.Up);
    expect(g.roll).toBeLessThan(-0.5);
    for (let i = 0; i < 40; i++) g.tick(1 / 60, Key.Down);
    expect(g.roll).toBeGreaterThan(0.5);
    for (let i = 0; i < 90; i++) g.tick(1 / 60);
    expect(Math.abs(g.roll)).toBeLessThan(0.001);
  });
});
