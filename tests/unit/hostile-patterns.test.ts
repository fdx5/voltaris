import { describe, expect, it } from 'vitest';
import designs from '../../data/enemies/fleet-designs.json';
import defs from '../../data/enemies/enemy-defs.json';
import mounts from '../../data/enemies/fleet-hardpoints.json';
import { enemySalvo, bossSalvo, groundSalvo, heavySalvo } from '../../src/game/HostilePatterns';
import { STAGES } from '../../src/game/stages';
import { GameState } from '../../src/game/GameState';

describe('independent fleet designs and armaments', () => {
  it('has 54 named designs, palettes and distinct deterministic firing recipes', () => {
    expect(new Set(designs.map((d) => d.design)).size).toBe(54);
    expect(new Set(designs.map((d) => d.palette[0])).size).toBe(54);
    const signatures = designs.map((d, i) => {
      const plan = enemySalvo(i, 2.7, 3);
      expect(plan).toEqual(enemySalvo(i, 2.7, 3));
      expect(d.pattern).toBe(defs[i].fire.pattern);
      for (const shot of plan) {
        expect(shot.mount).toBeLessThan(mounts[i].muzzles.length);
        expect(shot.kind).toBeGreaterThanOrEqual(0);
        expect(shot.kind).toBeLessThan(10);
        expect(shot.delay).toBeGreaterThanOrEqual(0);
        expect(shot.delay).toBeLessThanOrEqual(1.3);
        expect(shot.speed).toBeGreaterThan(0);
        expect(Object.values(shot).every(Number.isFinite)).toBe(true);
      }
      return JSON.stringify(plan);
    });
    expect(new Set(signatures).size).toBe(54);
    // Every family flies its own imported hull.
    expect(new Set(mounts.map((m) => `${m.source}/${m.model}`)).size).toBe(54);
  });
  it('gives medium ships larger hulls, more health and more complex bursts', () => {
    const medium = designs.filter((d) => d.size === 'medium');
    const small = designs.filter((d) => d.size === 'small');
    expect(medium.length).toBe(13);
    expect(Math.min(...medium.map((d) => defs[d.id].hp))).toBeGreaterThan(
      Math.max(...small.map((d) => defs[d.id].hp)) * 4,
    );
    expect(Math.min(...medium.map((d) => defs[d.id].radius))).toBeGreaterThan(
      Math.max(...small.map((d) => defs[d.id].radius)) * 1.6,
    );
    expect(Math.min(...medium.map((d) => enemySalvo(d.id, Math.PI, 0).length))).toBeGreaterThan(
      Math.max(...small.map((d) => enemySalvo(d.id, Math.PI, 0).length)),
    );
  });
  it.each([
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 2],
  ])('flies stage %i medium hulls in formations of %i', (stageIndex, size) => {
    const waves = STAGES[stageIndex].spawns.filter((w) => defs[w.type].sizeClass === 'medium');
    expect(waves.length).toBeGreaterThan(0);
    for (const wave of waves) expect(wave.count).toBe(size);
  });
  it('has twelve unique boss phases and twelve separate emplacement recipes', () => {
    const boss = [0, 1, 2, 3].flatMap((s) =>
      [1, 2, 3].map((p) => JSON.stringify(bossSalvo(s, p, 2, 2.8))),
    );
    expect(new Set(boss).size).toBe(12);
    expect(
      new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(groundSalvo(i, 2.8, 2)))).size,
    ).toBe(12);
    for (const s of [0, 1, 2, 3])
      for (const p of [1, 2, 3]) {
        const plan = bossSalvo(s, p, 1, Math.PI);
        expect(plan.length).toBeLessThanOrEqual(60);
        expect(plan.every((shot) => Object.values(shot).every(Number.isFinite))).toBe(true);
      }
  });
});

describe('medium gunship barrages', () => {
  const medium = mounts.flatMap((m, i) => (m.size === 'medium' ? [i] : []));
  it('fires dense, deterministic phrases that change with every volley', () => {
    for (const type of medium) {
      const phrases = new Set<string>();
      for (let cycle = 0; cycle < 6; cycle++) {
        const plan = heavySalvo(type, 2.9, cycle);
        expect(plan).toEqual(heavySalvo(type, 2.9, cycle));
        expect(plan.length).toBeGreaterThanOrEqual(24);
        expect(plan.length).toBeLessThanOrEqual(60);
        expect(plan.every((shot) => Object.values(shot).every(Number.isFinite))).toBe(true);
        expect(plan.every((shot) => shot.delay <= 1.3 && shot.speed > 0)).toBe(true);
        phrases.add(JSON.stringify(plan));
      }
      expect(phrases.size).toBe(6);
    }
  });
  it('fields mediums one to four abreast with 2.5 to 4 times the armour', () => {
    const g = new GameState();
    g.start('LASER', 3, false, false, 0);
    expect(g.mediumCount).toBe(1);
    expect(g.mediumArmour).toBe(2.5);
    g.start('LASER', 3, false, false, 3);
    g.time = g.stage.durationSec;
    expect(g.mediumCount).toBe(4);
    expect(g.mediumArmour).toBe(4);
  });
});

describe('armour hit feedback', () => {
  it('bursts on a gunship hull where it is struck, but not on a light hull', () => {
    const g = new GameState();
    g.start('LASER', 3, true);
    g.boss = false;
    const medium = mounts.findIndex((m) => m.size === 'medium'),
      light = mounts.findIndex((m) => m.size === 'small');
    const heavy = g.enemies.acquire(5, 0, 0, 0, medium, 30, 1.2, 1e6);
    g.damageEnemy(heavy, 1, 0, 0);
    expect(g.armourHitEvent).toBe(1);
    const k = g.impactAge.findIndex((age) => age === 0);
    expect(k).toBeGreaterThanOrEqual(0);
    // On the struck side of the hull, not at its centre.
    expect(g.impactX[k]).toBeLessThan(5);
    expect(Math.hypot(g.impactX[k] - 5, g.impactY[k])).toBeLessThan(1.8);
    const small = g.enemies.acquire(5, 3, 0, 0, light, 30, 0.4, 1e6);
    g.damageEnemy(small, 1, 0, 3);
    expect(g.armourHitEvent).toBe(1);
  });
});

function startRailBurst() {
  const game = new GameState();
  game.start('LASER', 3, true);
  game.boss = false;
  game.autoFire = false;
  game.invincible = 100;
  const slot = game.enemies.acquire(8, 0, 0, 0, 1, 20, defs[1].radius, 100);
  game.enemies.life[slot] = 0;
  for (let n = 0; n < 900 && !game.bullets.count; n++) game.tick(1 / 60);
  expect(game.bullets.count).toBeGreaterThan(0);
  return { game, slot };
}
describe('multi-step salvo lifecycle', () => {
  it('cancels the remaining burst when a shooter dies, including a reused slot', () => {
    const { game, slot } = startRailBurst();
    game.enemies.release(slot);
    game.bullets.clear();
    const reused = game.enemies.acquire(8, 0, 0, 0, 0, 20, 0.4, 100);
    expect(reused).toBe(slot);
    game.enemies.life[reused] = 0;
    game.enemies.age[reused] = -100;
    for (let n = 0; n < 90; n++) game.tick(1 / 60);
    expect(game.bullets.count).toBe(0);
  });
  it('freezes queued shots while paused and resumes their timing', () => {
    const { game } = startRailBurst();
    game.bullets.clear();
    game.pause();
    for (let n = 0; n < 90; n++) game.tick(1 / 60);
    expect(game.bullets.count).toBe(0);
    game.pause();
    for (let n = 0; n < 24; n++) game.tick(1 / 60);
    expect(game.bullets.count).toBeGreaterThan(0);
  });
});
