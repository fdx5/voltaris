import { describe, it, expect } from 'vitest';
import { ObjectPool } from '../../src/core/pool/ObjectPool';
import { BulletPool } from '../../src/game/entities/BulletPool';
import { SpatialHash, segmentCircle } from '../../src/game/systems/SpatialHash';
import { GameState } from '../../src/game/GameState';
import { STAGES } from '../../src/game/stages';
import defs from '../../data/enemies/enemy-defs.json';
import fleetHardpoints from '../../data/enemies/fleet-hardpoints.json';
import fleetDesigns from '../../data/enemies/fleet-designs.json';
import { Key } from '../../src/core/input/InputManager';
const dt = 1 / 60;
const mediumTypes = fleetHardpoints.reduce<number[]>((acc, f, i) => {
  if (f.size === 'medium') acc.push(i);
  return acc;
}, []);
describe('fixed pools and collision broadphase', () => {
  it('keeps the occupied bound correct across holes, reuse, expiration and reset', () => {
    const p = new ObjectPool(100);
    for (let i = 0; i < 6; i++) p.acquire(i, 0, 1, 0, 0, 1);
    expect(p.limit).toBe(6);
    p.release(4);
    p.release(5);
    expect(p.limit).toBe(4);
    expect(p.acquire(10, 0, 1, 0, 0, 1)).toBe(5);
    expect(p.limit).toBe(6);
    p.move(0.5);
    expect(p.x[5]).toBe(10.5);
    p.move(1);
    expect(p.limit).toBe(0);
    expect(p.count).toBe(0);
    p.acquire(0, 0);
    p.clear();
    expect(p.limit).toBe(0);
    expect(p.acquire(0, 0)).toBe(0);
  });
  it('exhausts, rejects overflow, reuses slots and ignores duplicate release', () => {
    const p = new ObjectPool(3);
    expect([p.acquire(0, 0), p.acquire(1, 1), p.acquire(2, 2), p.acquire(3, 3)]).toEqual([
      0, 1, 2, -1,
    ]);
    p.release(1);
    p.release(1);
    expect(p.count).toBe(2);
    expect(p.acquire(4, 4)).toBe(1);
    expect(p.count).toBe(3);
    p.clear();
    expect(p.count).toBe(0);
    expect(p.acquire(0, 0)).toBe(0);
  });
  it('resets graze and hit bookkeeping on bullet reuse', () => {
    const p = new BulletPool(1);
    p.fire(0, 0, 0, 0, 1);
    p.grazed[0] = 1;
    p.lastHit[0] = 5;
    p.release(0);
    p.fire(0, 0, 0, 0, 0);
    expect(p.grazed[0]).toBe(0);
    expect(p.lastHit[0]).toBe(-1);
  });
  it('finds neighboring cells without distant candidates', () => {
    const h = new SpatialHash(10);
    h.insert(0, -0.1, 0);
    h.insert(1, 0.1, 0);
    h.insert(2, 10, 10);
    h.query(0, 0, 0.5);
    expect(Array.from(h.results.slice(0, h.resultCount)).sort()).toEqual([0, 1]);
    h.clear();
    expect(h.query(0, 0, 10)).toBe(0);
  });
  it('indexes entities out past the old +/-14 bound (Section 5 reaches y = +/-21.6)', () => {
    const h = new SpatialHash(10);
    h.insert(0, 0, 21.6);
    h.insert(1, 0, -21.6);
    expect(h.query(0, 21.6, 0.5)).toBe(1);
    expect(h.query(0, -21.6, 0.5)).toBe(1);
  });
  it('detects swept hits that discrete endpoints miss', () => {
    expect(segmentCircle(-2, 0, 2, 0, 0, 0, 0.12)).toBe(true);
    expect(segmentCircle(-2, 1, 2, 1, 0, 0, 0.12)).toBe(false);
  });
});
describe('arcade rules', () => {
  it('records every pickup type when several are collected in the same tick', () => {
    const g = new GameState();
    g.start('LASER', 3);
    g.respawn = 0;
    const level = g.level;
    const options = g.optionCount;
    for (const type of [0, 1, 2, 3, 0]) g.items.acquire(g.x, g.y, 0, 0, type, 12, 0.5);
    g.tick(dt);
    expect(Array.from(g.pickupEventsByType)).toEqual([2, 1, 1, 1]);
    expect(g.pickupEvent).toBe(5);
    expect(g.items.count).toBe(0);
    expect(g.level).toBe(level + 2);
    expect(g.optionCount).toBe(options + 1);
    expect(g.shield).toBe(3);
    expect(g.skillUnlocked).toBe(true);
  });
  it('clamps diagonal movement and records replay input', () => {
    const g = new GameState();
    g.start('LASER', 3);
    g.tick(dt, Key.Left | Key.Up, 0, 500, 500);
    expect(g.x).toBe(12.8);
    expect(g.y).toBe(7.2);
    expect(g.replayFrames).toBe(1);
    expect(g.replay[1]).toBe(500);
  });
  it('is deterministic for the same complete input stream', () => {
    const a = new GameState(),
      b = new GameState();
    a.start('SPREAD', 9);
    b.start('SPREAD', 9);
    for (let i = 0; i < 6000; i++) {
      const bits = i % 240 < 120 ? Key.Up : Key.Down;
      a.tick(dt, bits);
      b.tick(dt, bits);
    }
    expect(a.score).toBe(b.score);
    expect(a.rng.seed).toBe(b.rng.seed);
    expect(a.bullets.x).toEqual(b.bullets.x);
    expect(a.enemies.hp).toEqual(b.enemies.hp);
    expect(a.replay).toEqual(b.replay);
  });
  it('pauses simulation time and resumes with ESC', () => {
    const g = new GameState();
    g.start('LASER', 1);
    g.tick(dt, 0, Key.Pause);
    const t = g.time;
    g.tick(dt, Key.Right);
    expect(g.time).toBe(t);
    expect(g.status).toBe('paused');
    g.tick(dt, 0, Key.Pause);
    expect(g.status).toBe('playing');
  });
  it('preserves score and resets power/charge on continue', () => {
    const g = new GameState();
    g.start('LASER', 3);
    g.score = 4200;
    g.level = 8;
    g.charge.fill(1);
    g.lives = 1;
    g.invincible = 0;
    g.hit();
    expect(g.status).toBe('continue');
    g.continueRun();
    expect(g.score).toBe(4200);
    expect(g.lives).toBe(3);
    expect(g.level).toBe(1);
    expect(g.charge[0]).toBe(0);
    expect(g.creditsUsed).toBe(2);
    expect(g.status).toBe('playing');
  });
  it('ends after 10 seconds of unanswered continue', () => {
    const g = new GameState();
    g.start('LASER', 3);
    g.lives = 1;
    g.invincible = 0;
    g.hit();
    for (let i = 0; i < 601; i++) g.tick(dt);
    expect(g.status).toBe('gameover');
  });
  it('cannot continue with no remaining credit', () => {
    const g = new GameState();
    g.start('LASER', 1);
    g.lives = 1;
    g.invincible = 0;
    g.hit();
    g.continueRun();
    expect(g.status).toBe('gameover');
    expect(g.creditsUsed).toBe(1);
  });
  it('protects during shield and resurrection immunity', () => {
    const g = new GameState();
    g.start('LASER', 2);
    g.invincible = 0;
    g.shield = 3;
    g.hit();
    g.hit();
    expect(g.shield).toBe(2);
    expect(g.lives).toBe(3);
  });
  it('guarantees carrier drops and caps kill-based skill charge', () => {
    const g = new GameState();
    g.start('LASER', 1);
    g.enemies.acquire(0, 0, 0, 0, 2, 8, 0.5, 1);
    g.damageEnemy(0, 2);
    expect(g.items.count).toBe(1);
    expect(g.kills).toBe(1);
    expect(g.charge[0]).toBeCloseTo(1 / 40);
  });
  it('requires skill acquisition before overdrive activation', () => {
    const g = new GameState();
    g.start('LASER', 1);
    g.charge[0] = 1;
    g.activate(0);
    expect(g.effects[0]).toBe(0);
    g.skillUnlocked = true;
    g.activate(0);
    expect(g.effects[0]).toBe(3);
    expect(g.invincible).toBe(3);
    expect(g.charge[0]).toBe(0);
  });
  it('freezes options in place while the player moves', () => {
    const g = new GameState();
    g.start('LASER', 1, true);
    g.mode = 1;
    g.tick(dt);
    const x = g.optionX[0];
    for (let i = 0; i < 30; i++) g.tick(dt, Key.Right | Key.Hold);
    expect(g.optionX[0]).toBe(x);
    expect(g.x).toBeGreaterThan(-7);
  });
  it('directional options aim vertically, rotate orbits with hold', () => {
    const g = new GameState();
    g.start('LASER', 1, true);
    g.mode = 2;
    g.tick(dt, Key.Up | Key.Hold);
    expect(g.optionAngle[0]).toBeCloseTo(Math.PI / 2);
    g.mode = 3;
    g.tick(dt, Key.Hold);
    expect(Math.hypot(g.optionX[0] - g.x, g.optionY[0] - g.y)).toBeCloseTo(1.8);
  });
  it('transitions boss phases with a two second invulnerable interval', () => {
    const g = new GameState();
    g.start('LASER', 1, true);
    // Phases turn at 60% and 25% of the stage's boss hull.
    g.bossHp = g.stage.boss.hp * 0.36;
    g.tick(dt);
    expect(g.bossPhase).toBe(2);
    expect(g.bossTransition).toBeGreaterThan(1.9);
    g.bossHp = g.stage.boss.hp * 0.14;
    g.tick(dt);
    expect(g.bossPhase).toBe(3);
  });
  it('keeps a boss with remaining HP alive after 180 seconds', () => {
    const g = new GameState();
    g.start('LASER', 1, true);
    g.bossTime = 180;
    g.tick(dt);
    expect(g.status).toBe('playing');
    expect(g.bossDefeated).toBe(false);
    expect(g.bossHp).toBeGreaterThan(0);
    expect(g.bossDying).toBe(false);
  });
  it('tints hostile fire from a vivid warning palette, not each ship\'s muted hull colour', () => {
    const g = new GameState();
    g.start('LASER', 9, false, false, 0);
    g.invincible = 99;
    const seen = new Set<number>();
    for (let n = 0; n < 40 * 60 && seen.size < 2; n++) {
      g.tick(dt);
      for (let i = 0; i < g.bullets.limit; i++) {
        if (g.bullets.active[i] && g.bullets.type[i] === 1 && g.bullets.tint[i])
          seen.add(g.bullets.tint[i]);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
    const hullTones = new Set(fleetDesigns.map((f) => parseInt(f.palette[1].slice(1), 16)));
    for (const tint of seen) expect(hullTones.has(tint)).toBe(false);
  });
  it('keeps escort squads of small and medium hulls arriving during a Section 5 boss fight', () => {
    const g = new GameState();
    g.start('LASER', 9, true, false, 4);
    expect(g.boss).toBe(true);
    for (let n = 0; n < 12 * 60; n++) g.tick(dt);
    expect(g.enemies.count).toBeGreaterThan(0);
    let mediumSeen = false;
    for (let i = 0; i < g.enemies.limit; i++) {
      if (g.enemies.active[i] && mediumTypes.includes(g.enemies.type[i])) mediumSeen = true;
    }
    expect(mediumSeen).toBe(true);
  });
  it('stress harness maintains 4000 bullets without overflow', () => {
    const g = new GameState();
    g.stressCount = 4000;
    g.startStress();
    for (let i = 0; i < 600; i++) g.tick(dt);
    expect(g.bullets.count).toBe(4000);
    expect(g.bulletGrid.resultCount).toBeGreaterThan(0);
  });
  it('graze scores once per hostile projectile and actual hit loses one life', () => {
    const g = new GameState();
    g.start('LASER', 1);
    g.invincible = 0;
    g.bullets.fire(g.x, g.y + 0.4, 0, 0, 1, 0.1);
    g.tick(dt);
    g.tick(dt);
    expect(g.graze).toBeCloseTo(1.01);
    g.bullets.fire(g.x, g.y, 0, 0, 1, 0.1);
    g.tick(dt);
    expect(g.lives).toBe(2);
    expect(g.graze).toBe(1);
  });
  it('drops recovery power sized by the level the ship was lost at', () => {
    for (const [level, expected] of [
      [8, 3],
      [7, 2],
      [3, 2],
      [2, 1],
      [1, 1],
    ] as const) {
      const g = new GameState();
      g.start('LASER', 3);
      g.level = level;
      g.invincible = 0;
      g.items.clear();
      g.hit();
      let power = 0;
      for (let i = 0; i < g.items.capacity; i++)
        if (g.items.active[i] && g.items.type[i] === 0) power++;
      expect(power).toBe(expected);
    }
  });
  it('keeps the upgrade state across a stage but not across a fresh sortie', () => {
    const g = new GameState();
    g.start('LASER', 1, true);
    g.bossPhase = 3;
    g.bossTransition = 0;
    g.level = 6;
    g.optionCount = 3;
    g.shield = 2;
    g.bossHp = 1;
    g.effects[4] = 1;
    g.tick(dt);
    expect(g.bossDying).toBe(true);
    for (let i = 0; i < 420; i++) g.tick(dt);
    expect(g.status).toBe('clear');
    g.start('LASER', 1, false, true);
    expect(g.level).toBe(6);
    expect(g.optionCount).toBe(3);
    expect(g.shield).toBe(2);
    g.start('LASER', 1);
    expect(g.level).toBe(1);
    // A fresh sortie drops the carried options but always keeps the first one.
    expect(g.optionCount).toBe(1);
    expect(g.shield).toBe(0);
  });
  it('halves hostile fire volume while the player is at minimum power', () => {
    const roundsFiredIn20s = (level: number) => {
      const g = new GameState();
      g.start('LASER', 3, true);
      g.boss = false;
      g.enemies.clear();
      const e = g.enemies.acquire(10, 0, 0, 0, 0, 1e9, 0.5, 1e9);
      g.enemies.life[e] = 0;
      let fired = 0;
      for (let f = 0; f < 60 * 20; f++) {
        g.level = level;
        g.enemies.hp[e] = 1e9;
        g.enemies.vx[e] = 0;
        g.bullets.clear();
        g.tick(dt);
        for (let i = 0; i < g.bullets.capacity; i++)
          if (g.bullets.active[i] && g.bullets.type[i] === 1) fired++;
      }
      return fired;
    };
    const weak = roundsFiredIn20s(1),
      armed = roundsFiredIn20s(5);
    expect(armed).toBeGreaterThan(0);
    expect(weak / armed).toBeGreaterThan(0.4);
    expect(weak / armed).toBeLessThan(0.6);
  });
  it('opens with a small formation and builds the field up over the stage', () => {
    const g = new GameState();
    const fly = (seconds: number) => {
      for (let i = 0; i < 60 * seconds; i++) {
        g.invincible = 1;
        g.tick(dt);
      }
    };
    g.start('LASER', 3);
    // Hostiles now jink across the ship's firing line, so a stationary gun
    // thins them out at a rate that has nothing to do with wave build-up.
    g.autoFire = false;
    fly(5);
    const opening = g.enemies.count;
    expect(opening).toBeGreaterThan(0);
    expect(opening).toBeLessThanOrEqual(3);
    fly(15);
    expect(g.enemies.count).toBeGreaterThan(opening);
    // Overlapping emitter lanes are what let the later waves stack up at all.
    fly(40);
    expect(g.enemies.count).toBeGreaterThan(25);
  });
  it('loads stage two with its own boss, pod count and pressure', () => {
    const g = new GameState();
    g.start('LASER', 3, false, false, 1);
    expect(g.stageIndex).toBe(1);
    expect(g.stage.name).toBe('IRON BELT');
    expect(g.stage.boss.id).toBe('ARES CROWN');
    g.spawnBoss();
    expect(g.bossHp).toBe(g.stage.boss.hp);
    expect(g.bossParts).toBe(6);
    for (let p = 0; p < 6; p++) expect(g.partHp[p]).toBe(g.stage.boss.partHp);
  });
  it('keeps at most half of stage one roster and fields eight new hulls', () => {
    const roster = (i: number) => new Set(STAGES[i].spawns.map((w) => w.type));
    const one = roster(0),
      two = roster(1);
    const shared = [...two].filter((t) => one.has(t));
    expect(shared.length / one.size).toBeLessThanOrEqual(0.5);
    expect([...two].filter((t) => !one.has(t)).length).toBe(8);
  });
  it('trades cadence for volley size in stage two', () => {
    // twin fires a pair per step and petal a trio, so a volley is not the
    // authored count.
    const perVolley = (fire: (typeof defs)[number]['fire']) =>
      fire.count * (fire.pattern === 'twin' ? 2 : fire.pattern === 'petal' ? 3 : 1);
    const average = (index: number) => {
      const roster = [...new Set(STAGES[index].spawns.map((w) => w.type))];
      return roster.reduce((sum, t) => sum + perVolley(defs[t].fire), 0) / roster.length;
    };
    // The belt garrison shoots less often than the orbital defence but throws
    // considerably more per shot.
    expect(STAGES[1].pressure).toBeLessThan(STAGES[0].pressure);
    expect(average(1)).toBeGreaterThan(average(0));
  });
  it('flies stage three over terrain with emplacements and a bomb salvo', () => {
    const g = new GameState();
    g.start('LASER', 3, false, false, 2);
    expect(g.stage.name).toBe('IO SURFACE');
    expect(g.stage.boss.id).toBe('JOVE ANVIL');
    // The final boss carries twice stage two's hull.
    expect(g.stage.boss.hp).toBe(STAGES[1].boss.hp * 2);
    expect(g.stage.boss.parts).toBe(8);
    expect(g.terrain).not.toBeNull();
    // Every hull in the roster is new to this stage.
    const earlier = new Set([...STAGES[0].spawns, ...STAGES[1].spawns].map((w) => w.type));
    const roster = [...new Set(g.stage.spawns.map((w) => w.type))];
    expect(roster.length).toBe(13);
    expect(roster.some((t) => earlier.has(t))).toBe(false);
    for (let i = 0; i < 60 * 20; i++) {
      g.invincible = 1;
      g.tick(dt);
    }
    expect(g.scroll).toBeGreaterThan(0);
    expect(g.ground.count).toBeGreaterThan(0);
    let bombs = 0;
    for (let i = 0; i < g.bullets.capacity; i++)
      if (g.bullets.active[i] && g.bullets.type[i] === 4) bombs++;
    expect(bombs).toBeGreaterThan(0);
  });
  it('grows the bomb salvo from two to five with weapon power', () => {
    const g = new GameState();
    g.start('LASER', 3, false, false, 2);
    const sizes = [1, 2, 3, 4, 5, 6, 7, 8].map((level) => {
      g.level = level;
      return g.salvoSize;
    });
    expect(sizes).toEqual([2, 2, 3, 3, 4, 4, 5, 5]);
  });
  it('seats emplacements on the surface the renderer draws', () => {
    const g = new GameState();
    g.start('LASER', 3, false, false, 2);
    for (let i = 0; i < 60 * 12; i++) {
      g.invincible = 1;
      g.tick(dt);
    }
    let seated = 0;
    for (let i = 0; i < g.ground.capacity; i++) {
      if (!g.ground.active[i]) continue;
      seated++;
      // Same height function, same arguments: what you shoot is what you see.
      expect(g.ground.y[i]).toBeCloseTo(g.terrain!.height(g.ground.x[i] + g.scroll, 0), 5);
    }
    expect(seated).toBeGreaterThan(0);
  });
  it('hardens hulls as a sortie runs and keeps the opening wave soft', () => {
    const g = new GameState();
    g.start('LASER', 3);
    expect(g.hullScale).toBeCloseTo(g.stage.hull);
    g.time = g.stage.durationSec;
    expect(g.hullScale).toBeCloseTo(g.stage.hull * 1.75);
    // A hull that spawns late really does arrive with more integrity.
    const spawnOne = (at: number) => {
      const s = new GameState();
      s.start('LASER', 3);
      s.time = at;
      s.enemies.clear();
      for (let i = 0; i < 60 * 4; i++) {
        s.invincible = 1;
        s.tick(dt);
      }
      let best = 0;
      for (let i = 0; i < s.enemies.capacity; i++)
        if (s.enemies.active[i]) best = Math.max(best, s.enemies.hp[i]);
      return best;
    };
    expect(spawnOne(150)).toBeGreaterThan(spawnOne(0));
  });
  it('flies stage four through a cave with a roof as well as a deck', () => {
    const g = new GameState();
    g.start('LASER', 3, false, false, 3);
    expect(g.stage.name).toBe('GLACIAL VAULT');
    expect(g.stage.boss.id).toBe('NEREID');
    // The final boss carries half again what stage three's did.
    expect(g.stage.boss.hp).toBe(STAGES[2].boss.hp * 1.5);
    expect(g.stage.boss.parts).toBe(10);
    expect(g.terrain).not.toBeNull();
    expect(g.roof).not.toBeNull();
    // The vault hangs below its own base; the deck rises above its own.
    expect(g.surfaceAt(0, true)).toBeLessThan(g.stage.surface!.roof!.base + 0.001);
    expect(g.surfaceAt(0)).toBeGreaterThan(g.stage.surface!.base - 0.001);
    // The corridor the ship may fly in stays clear of both surfaces.
    for (let x = -12; x <= 12; x += 0.5) {
      expect(g.surfaceAt(x)).toBeLessThan(g.stage.minY);
      expect(g.surfaceAt(x, true)).toBeGreaterThan(g.stage.maxY);
    }
  });
  it('fields ten exclusive stage-four hulls with stronger medium craft', () => {
    const roster = [...new Set(STAGES[3].spawns.map((w) => w.type))];
    expect(roster.length).toBe(10);
    const earlier = new Set(
      [...STAGES[0].spawns, ...STAGES[1].spawns, ...STAGES[2].spawns].map((w) => w.type),
    );
    expect(roster.some((t) => earlier.has(t))).toBe(false);
    const small = roster.filter((t) => defs[t].sizeClass === 'small').map((t) => defs[t].hp);
    const medium = roster.filter((t) => defs[t].sizeClass === 'medium').map((t) => defs[t].hp);
    expect(medium.length).toBeGreaterThan(0);
    expect(Math.min(...medium)).toBeGreaterThan(Math.max(...small) * 4);
  });
  it('gives every stage four hull its own pattern and projectile', () => {
    const roster = [...new Set(STAGES[3].spawns.map((w) => w.type))];
    expect(new Set(roster.map((t) => defs[t].fire.pattern)).size).toBe(roster.length);
    expect(new Set(roster.map((t) => defs[t].fire.kind)).size).toBe(roster.length);
  });
  it('gives every stage its own track and its own boss track', () => {
    for (const stage of STAGES) {
      expect(stage.music).toMatch(/^\/audio\/.+\.mp3$/);
      expect(stage.bossMusic).toMatch(/^\/audio\/.+\.mp3$/);
      expect(stage.bossMusic).not.toBe(stage.music);
    }
    // One boss track each, no sharing.
    const tracks = STAGES.map((s) => s.bossMusic);
    expect(new Set(tracks).size).toBe(tracks.length);
  });
  it('flies stage one with an option already attached', () => {
    const g = new GameState();
    g.start('LASER', 3, false, false, 0);
    expect(g.optionCount).toBe(1);
    // A death scatters the extras as rings but never leaves the ship bare.
    g.optionCount = 3;
    g.invincible = 0;
    g.hit();
    expect(g.optionCount).toBe(1);
  });
  it('gives each option control mode its own behaviour under the hold key', () => {
    const settle = (mode: number) => {
      const g = new GameState();
      g.start('LASER', 3, false, false, 0);
      g.optionCount = 4;
      g.mode = mode;
      for (let i = 0; i < 90; i++) g.tick(dt, Key.Up, 0, 0, 0);
      const free = { x: g.optionX[0], y: g.optionY[0] };
      for (let i = 0; i < 40; i++) g.tick(dt, Key.Hold | Key.Down, 0, 0, -1);
      return { g, free };
    };
    // TRAIL: still following, but tucked in much closer than it flies loose.
    const trail = settle(0);
    expect(trail.g.optionHold).toBe(true);
    expect(Math.abs(trail.g.optionY[0] - trail.g.y)).toBeLessThan(1);
    // Tucked in, but never inside the hull.
    expect(trail.g.optionX[0] - trail.g.x).toBeGreaterThan(-0.9);
    expect(trail.g.optionX[0]).toBeLessThanOrEqual(trail.g.x - 0.5);
    // FREEZE: pinned where it stood when the key went down.
    const freeze = settle(1);
    expect(freeze.g.optionY[0]).toBeCloseTo(freeze.free.y, 5);
    expect(freeze.g.optionX[0]).toBeCloseTo(freeze.free.x, 5);
    expect(Math.abs(freeze.g.optionY[0] - freeze.g.y)).toBeGreaterThan(2);
    // DIRECTIONAL: trailing as usual, guns turned to the stick.
    const aim = settle(2);
    expect(aim.g.optionAngle[0]).toBeCloseTo(-Math.PI / 2, 2);
    // ROTATE: swung out around the ship, gun following the orbit.
    const spin = settle(3);
    const r = Math.hypot(spin.g.optionX[0] - spin.g.x, spin.g.optionY[0] - spin.g.y);
    expect(r).toBeCloseTo(1.8, 1);
    // Letting go puts every mode back on the trail with the guns forward.
    for (let i = 0; i < 40; i++) spin.g.tick(dt, 0, 0, 0, 0);
    expect(spin.g.optionHold).toBe(false);
    expect(spin.g.optionAngle[0]).toBe(0);
  });
  it('announces the mode the control key now drives', () => {
    const g = new GameState();
    g.start('LASER', 3, false, false, 0);
    for (const name of ['FREEZE', 'DIRECTIONAL', 'ROTATE', 'TRAIL']) {
      g.cycleMode();
      expect(g.notice).toContain(name);
      expect(g.noticeTime).toBeGreaterThan(0);
    }
  });
  it('keeps every stage four formation inside the corridor the ship can fly', () => {
    const g = new GameState();
    g.start('LASER', 3, false, false, 3);
    let seen = 0;
    for (let i = 0; i < 60 * 120; i++) {
      g.invincible = 1;
      g.tick(dt);
      for (let e = 0; e < g.enemies.capacity; e++) {
        if (!g.enemies.active[e] || g.enemies.x[e] > 12) continue;
        seen++;
        // Above the ship's own ceiling an enemy is unreachable: the player is
        // clamped below it and only the ground salvo climbs any higher.
        expect(g.enemies.y[e]).toBeLessThanOrEqual(g.stage.maxY);
        expect(g.enemies.y[e]).toBeGreaterThanOrEqual(g.stage.minY);
      }
    }
    expect(seen).toBeGreaterThan(1000);
  });
  it('mounts emplacements on both surfaces and bombs both ways', () => {
    const g = new GameState();
    g.start('LASER', 3, false, false, 3);
    expect(STAGES[3].ground.some((e) => e.roof === 1)).toBe(true);
    expect(STAGES[3].ground.some((e) => e.roof === 0)).toBe(true);
    // Emplacements only live a few seconds, so both mounts are counted over
    // the run rather than sampled from one frame.
    let deck = 0,
      vault = 0;
    for (let i = 0; i < 60 * 25; i++) {
      g.invincible = 1;
      g.tick(dt);
      for (let k = 0; k < g.ground.capacity; k++) {
        if (!g.ground.active[k]) continue;
        const roof = g.ground.aux[k] === 1;
        // Seated with the same height function the renderer draws with.
        expect(g.ground.y[k]).toBeCloseTo(g.surfaceAt(g.ground.x[k], roof), 5);
        if (roof) vault++;
        else deck++;
      }
    }
    expect(deck).toBeGreaterThan(0);
    expect(vault).toBeGreaterThan(0);
    let falling = 0,
      climbing = 0;
    for (let i = 0; i < g.bullets.capacity; i++) {
      if (!g.bullets.active[i]) continue;
      if (g.bullets.type[i] === 4) falling++;
      if (g.bullets.type[i] === 5) climbing++;
    }
    expect(falling).toBeGreaterThan(0);
    expect(climbing).toBeGreaterThan(0);
  });
  it("launches each stage's authored rocks inside its corridor", () => {
    for (let index = 0; index < STAGES.length; index++) {
      const stage = STAGES[index];
      expect(stage.hazards.length).toBeGreaterThan(0);
      for (const h of stage.hazards) {
        expect(h.time).toBeLessThan(stage.durationSec);
        expect(h.y).toBeGreaterThan(stage.minY);
        expect(h.y).toBeLessThan(stage.maxY);
      }
      const g = new GameState();
      g.start('LASER', 3, false, false, index);
      g.autoFire = false;
      const first = stage.hazards[0];
      while (g.time < first.time - dt) {
        g.invincible = 1;
        g.tick(dt);
      }
      expect(g.rocks.count).toBe(0);
      g.invincible = 1;
      g.tick(dt);
      expect(g.rocks.count).toBe(1);
      const i = g.rocks.active.indexOf(1);
      expect(g.rocks.y[i]).toBeCloseTo(first.y, 1);
      expect(g.rocks.radius[i]).toBeCloseTo(first.size, 5);
    }
  });
  it('costs a life to fly into a rock', () => {
    const g = new GameState();
    g.start('LASER', 3);
    g.invincible = 0;
    g.rocks.acquire(g.x + 0.5, g.y, 0, 0, 0, 1e9, 1, 30);
    g.tick(dt);
    expect(g.lives).toBe(2);
  });
  it('stops piercing shots on a rock and breaks it once worn down', () => {
    const g = new GameState();
    g.start('LASER', 3);
    g.level = 8;
    g.invincible = 99;
    // An enemy parked behind the rock must stay untouched while the rock stands.
    g.enemies.acquire(g.x + 8, g.y, 0, 0, 0, 30, 0.4, 1e6);
    const rock = g.rocks.acquire(g.x + 4, g.y, 0, 0, 0, 1e9, 1.2, 36);
    for (let n = 0; n < 5; n++) g.tick(dt);
    expect(g.rocks.active[rock]).toBe(1);
    expect(g.rocks.hp[rock]).toBeLessThan(36);
    expect(g.enemies.hp[g.enemies.active.indexOf(1)]).toBe(1e6);
    const score = g.score;
    for (let n = 0; n < 60 * 4 && g.rocks.active[rock]; n++) g.tick(dt);
    expect(g.rocks.active[rock]).toBe(0);
    expect(g.score).toBeGreaterThan(score);
  });
  it('sends no rocks at a boss training run', () => {
    const g = new GameState();
    g.start('LASER', 3, true);
    for (let i = 0; i < 60 * 12; i++) {
      g.invincible = 1;
      g.tick(dt);
    }
    expect(g.rocks.count).toBe(0);
  });
  it('drops a homing missile lock instead of tracking a different enemy that recycles the same pool slot', () => {
    const g = new GameState();
    g.start('MISSILE', 1);
    g.invincible = 99;
    // Enemy A: directly ahead, becomes the missile's initial lock.
    const a = g.enemies.acquire(g.x + 5, g.y, 0, 0, 0, 30, 0.4, 1e6);
    const genA = g.enemies.generation[a];
    const slot = g.bullets.fire(g.x, g.y, 20, 0, 2, 0.15, 1, 1);
    g.bullets.param[slot] = -1;
    g.tick(dt);
    expect(g.bullets.param[slot]).toBe(a);
    expect(g.bullets.heading[slot]).toBe(genA);
    // A dies and its pool slot is released, then immediately reused (the
    // pool's free list is LIFO) by an unrelated enemy B placed behind the
    // missile's nose - a spot the lock-acquisition scan would never pick.
    g.enemies.release(a);
    const b = g.enemies.acquire(g.x - 10, g.y + 6, 0, 0, 0, 30, 0.4, 1e6);
    expect(b).toBe(a);
    g.tick(dt);
    // The stale index must not be trusted just because its slot is active
    // again: the missile should have rescanned and refused B (behind, so
    // disqualified), not silently kept "tracking" whatever now sits there.
    expect(g.bullets.param[slot]).not.toBe(b);
  });
  it('restarts without carrying over bullets, rank, or credits used', () => {
    const g = new GameState();
    g.start('MISSILE', 9, true);
    for (let i = 0; i < 400; i++) g.tick(dt);
    g.start('LASER', 1);
    expect(g.bullets.count).toBe(0);
    expect(g.level).toBe(1);
    expect(g.optionCount).toBe(1);
    expect(g.boss).toBe(false);
    expect(g.rank).toBe(0);
    expect(g.replayFrames).toBe(0);
  });
});
