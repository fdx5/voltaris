import { describe, it, expect } from 'vitest';
import { GameState } from '../../src/game/GameState';
import { STAGES } from '../../src/game/stages';
import defs from '../../data/enemies/enemy-defs.json';
import { formationPosition } from '../../src/game/formations';

const dt = 1 / 60;
describe('boss refit', () => {
  it('starts the cinematic on a lethal projectile hit and pauses its clock', () => {
    const g = new GameState();
    g.start('LASER', 3, true);
    g.autoFire = false;
    g.bossX = 8;
    g.bossHp = 1;
    g.bossPhase = 3;
    g.bossTransition = 0;
    g.bullets.fire(8, 0, 0, 0, 0, 0.1, 10);
    g.tick(dt);
    expect(g.bossDying).toBe(true);
    expect(g.bossHp).toBe(0);
    g.pause();
    g.tick(3);
    expect(g.bossDeathTime).toBe(0);
    g.pause();
    g.tick(dt);
    expect(g.bossDeathTime).toBeCloseTo(dt);
  });
  it.each([0, 1, 2, 3])('stage %i has a safe seven-second destruction sequence', (stage) => {
    const g = new GameState();
    g.start('LASER', 3, true, false, stage);
    g.autoFire = false;
    g.bossPhase = 3;
    g.bossTransition = 0;
    g.bossHp = 1;
    g.effects[4] = 1;
    g.tick(dt);
    expect(g.bossHp).toBe(0);
    expect(g.bossDying).toBe(true);
    expect(g.status).toBe('playing');
    expect(g.bossDeathEvent).toBe(1);
    const lives = g.lives;
    for (let i = 0; i < 419; i++) {
      g.tick(dt);
      g.hit();
    }
    expect(g.lives).toBe(lives);
    expect(g.bullets.count).toBe(0);
    expect(g.particles.count).toBeGreaterThan(0);
    expect(g.status).toBe('playing');
    expect(g.bossDeathEvent).toBe(1);
    g.tick(dt);
    expect(g.status).toBe('clear');
    expect(g.bossDefeated).toBe(true);
    expect(g.boss).toBe(false);
    expect(g.bossDeathTime).toBeCloseTo(7);
    const score = g.score;
    g.tick(dt);
    expect(g.score).toBe(score);
  });

  it('initializes all ten Nereid weapon pods', () => {
    const g = new GameState();
    g.start('LASER', 3, true, false, 3);
    g.tick(dt);
    for (let p = 0; p < 10; p++) {
      expect(g.partHp[p]).toBe(g.stage.boss.partHp);
      expect(Number.isFinite(g.partX[p])).toBe(true);
      expect(Number.isFinite(g.partY[p])).toBe(true);
    }
  });

  it('gives every level distinct volleys and progressively shorter recovery', () => {
    const signatures: string[] = [],
      intervals: number[] = [];
    for (let stage = 0; stage < 4; stage++) {
      const g = new GameState();
      g.start('LASER', 3, true, false, stage);
      g.autoFire = false;
      g.bossTransition = 0;
      g.bossShot = 0;
      g.tick(dt);
      intervals.push(g.bossShot);
      const counts = new Array(10).fill(0);
      for (let i = 0; i < g.bullets.capacity; i++)
        if (g.bullets.active[i] && g.bullets.type[i] === 1) counts[g.bullets.kind[i]]++;
      signatures.push(JSON.stringify(counts));
    }
    expect(new Set(signatures).size).toBe(4);
    for (let i = 1; i < 4; i++) expect(intervals[i]).toBeLessThan(intervals[i - 1]);
  });

  it('doubles stage three air formations and triples ground deployment', () => {
    const g = new GameState();
    g.start('LASER', 3, false, false, 2);
    g.autoFire = false;
    for (let i = 0; i < 1200 && !g.enemies.count; i++) {
      g.invincible = 1;
      g.tick(dt);
    }
    const wave = g.stage.spawns[0];
    expect(g.enemies.count).toBe(Math.min(wave.count, g.stage.firstWave) * 2);
    g.ground.clear();
    // A fresh run isolates the first ground deployment from air encounters.
    g.start('LASER', 3, false, false, 2);
    g.autoFire = false;
    for (let i = 0; i < 1800 && !g.ground.count; i++) {
      g.invincible = 1;
      g.tick(dt);
    }
    expect(g.ground.count).toBe(3);
    const xs = [...g.ground.active.keys()]
      .filter((i) => g.ground.active[i])
      .map((i) => g.ground.x[i]);
    expect(new Set(xs).size).toBe(3);
  });

  it('keeps doubled air formations separated and within stage three bounds', () => {
    const stage = STAGES[2];
    for (const [ordinal, wave] of stage.spawns.entries()) {
      const r = defs[wave.type].radius,
        count = wave.count * 2;
      const min = stage.minY + r + 0.4,
        max = stage.maxY - r - 0.4;
      const positions = Array.from({ length: count }, (_, i) =>
        formationPosition(ordinal, i, count, r, wave.y, min, max),
      );
      for (const [i, p] of positions.entries()) {
        expect(p.y).toBeGreaterThanOrEqual(min - 1e-6);
        expect(p.y).toBeLessThanOrEqual(max + 1e-6);
        for (const q of positions.slice(i + 1))
          expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(r * 2);
      }
    }
  });
});
