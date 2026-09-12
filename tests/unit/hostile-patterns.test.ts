import { describe, expect, it } from 'vitest';
import designs from '../../data/enemies/fleet-designs.json';
import defs from '../../data/enemies/enemy-defs.json';
import mounts from '../../data/enemies/fleet-hardpoints.json';
import tuning from '../../data/tuning.json';
import { enemySalvo, bossSalvo, groundSalvo } from '../../src/game/HostilePatterns';
import { STAGES } from '../../src/game/stages';
import { GameState } from '../../src/game/GameState';

describe('independent fleet designs and armaments', () => {
  it('has 44 named designs, palettes and distinct deterministic firing recipes', () => {
    expect(new Set(designs.map((d) => d.design)).size).toBe(44);
    expect(new Set(designs.map((d) => d.palette[0])).size).toBe(44);
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
    expect(new Set(signatures).size).toBe(44);
    expect(new Set(mounts.map((m) => m.viewDegrees)).size).toBeGreaterThan(15);
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
  it.each([0, 1, 2, 3])(
    'keeps stage %i actual scheduled medium share near 30%% after caps',
    (stageIndex) => {
      const stage = STAGES[stageIndex];
      let total = 0,
        medium = 0;
      for (const [i, wave] of stage.spawns.entries()) {
        const count =
          Math.min(wave.count, stage.firstWave + i * tuning.spawn.growth) *
          (stageIndex === 2 ? 2 : 1);
        total += count;
        if (defs[wave.type].sizeClass === 'medium') medium += count;
      }
      expect(Math.abs(medium / total - 0.3)).toBeLessThan(0.006);
    },
  );
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
