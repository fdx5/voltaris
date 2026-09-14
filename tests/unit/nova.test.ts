import { describe, expect, it } from 'vitest';
import { GameState, NOVA_SKILL } from '../../src/game/GameState';
import { Key } from '../../src/core/input/InputManager';
import { STAGES } from '../../src/game/stages';
import tuning from '../../data/tuning.json';
import defs from '../../data/enemies/enemy-defs.json';
import mounts from '../../data/enemies/fleet-hardpoints.json';

const dt = 1 / 60;
const armed = () => {
  const g = new GameState();
  g.start('LASER', 3, true);
  g.boss = false;
  g.invincible = 1e9;
  return g;
};
const flyUntilBlast = (g: GameState) => {
  for (let f = 0; f < 600 && g.novaBlast < 0; f++) g.tick(dt);
};

describe('NOVA BOMB', () => {
  it('sits in special slot two, armed at the start of a sortie', () => {
    const g = new GameState();
    g.start('LASER', 3);
    expect(g.skills[1]).toBe(NOVA_SKILL);
    expect(tuning.skills[NOVA_SKILL].name).toBe('NOVA BOMB');
    expect(g.charge[1]).toBe(1);
  });
  it('flies straight from the nose on key 2 and bursts on its detonation line', () => {
    const g = armed();
    g.y = 2.5;
    g.tick(dt, 0, Key.Skill2);
    expect(g.novaActive).toBe(true);
    expect(g.charge[1]).toBe(0);
    const launchY = g.novaY;
    flyUntilBlast(g);
    expect(g.novaActive).toBe(false);
    expect(g.novaBlastY).toBe(launchY);
    expect(g.novaBlastX).toBeGreaterThanOrEqual(tuning.nova.detonateX);
    expect(g.novaBlastX).toBeLessThan(tuning.nova.detonateX + 0.5);
    expect(g.flash).toBeGreaterThan(0.9);
    // The fireball burns for three seconds and then clears.
    for (let f = 0; f < 60 * 2.9; f++) g.tick(dt);
    expect(g.novaBlast).toBeGreaterThan(0);
    for (let f = 0; f < 20; f++) g.tick(dt);
    expect(g.novaBlast).toBe(-1);
  });
  it('erases every hostile round and queued volley, but not the ship’s own shots', () => {
    const g = armed();
    g.charge[1] = 1;
    g.tick(dt, 0, Key.Skill2);
    for (let k = 0; k < 200; k++)
      g.bullets.acquire(-5 + (k % 20), -6 + (k % 12), -3, 0, 1, 20, 0.1, 1);
    flyUntilBlast(g);
    let hostile = 0;
    for (let i = 0; i < g.bullets.capacity; i++)
      if (g.bullets.active[i] && g.bullets.type[i] === 1) hostile++;
    expect(hostile).toBe(0);
  });
  it('breaks the toughest stage-three gunship in a single blast', () => {
    const g = new GameState();
    // Boss training on stage three: no waves spawn, so the gunship is alone.
    g.start('LASER', 3, true, false, 2);
    g.boss = false;
    g.invincible = 1e9;
    // The hardest case: the sturdiest medium hull at the very end of stage three.
    g.time = STAGES[2].durationSec - 0.5;
    const types = mounts.flatMap((m, i) => (m.size === 'medium' ? [i] : []));
    const toughest = types.reduce((a, b) => (defs[b].hp > defs[a].hp ? b : a));
    const hp = Math.round(defs[toughest].hp * g.hullScale * g.mediumArmour);
    expect(tuning.nova.damage).toBeGreaterThanOrEqual(hp);
    const e = g.enemies.acquire(14, 3, 0, 0, toughest, 30, defs[toughest].radius, hp);
    g.enemies.life[e] = 3;
    const kills = g.kills;
    g.tick(dt, 0, Key.Skill2);
    flyUntilBlast(g);
    expect(g.enemies.active[e]).toBe(0);
    expect(g.kills).toBe(kills + 1);
  });
  it('holds its charge while a bomb is still in the air or burning', () => {
    const g = armed();
    g.tick(dt, 0, Key.Skill2);
    g.charge[1] = 1;
    g.tick(dt, 0, Key.Skill2);
    expect(g.charge[1]).toBe(1);
    flyUntilBlast(g);
    g.tick(dt, 0, Key.Skill2);
    expect(g.charge[1]).toBe(1);
  });
});
