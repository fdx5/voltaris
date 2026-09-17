import { GameState } from '../src/game/GameState';
import type { Weapon } from '../src/game/GameState';
import { MAX_REPLAY_FRAMES, unpackReplay } from '../src/core/replayCodec';

export function verifyReplay(
  config: {
    weapon: Weapon;
    credits: number;
    practice: boolean;
    stage: number;
    autoFire: boolean;
    loadout?: { level: number; optionCount: number; shield: number };
  },
  events: number[][],
) {
  events = unpackReplay(events);
  const g = new GameState();
  if (config.loadout) Object.assign(g.loadout, config.loadout);
  g.start(config.weapon, config.credits, config.practice, !!config.loadout, config.stage - 1);
  g.mode = 0;
  g.autoFire = config.autoFire;
  let frames = 0;
  for (const event of events) {
    if (!Array.isArray(event) || event.length > 5 || !event.every(Number.isFinite))
      throw new Error('Invalid replay event');
    const [kind, a, b, x, y] = event;
    if (kind === 0) {
      if (
        event.length !== 5 ||
        !Number.isInteger(a) ||
        a < 0 ||
        a > 1023 ||
        !Number.isInteger(b) ||
        b < 0 ||
        b > 1023 ||
        Math.abs(x) > 32 ||
        Math.abs(y) > 18 ||
        ++frames > MAX_REPLAY_FRAMES
      )
        throw new Error('Invalid replay input');
      g.tick(1 / 60, a, b, x, y);
    } else if (kind === 1 && event.length === 2 && Number.isInteger(a) && a >= 0 && a <= 2)
      g.activate(a);
    else if (kind === 2 && event.length === 1) g.cycleMode();
    else if (kind === 3 && event.length === 1) g.continueRun();
    else if (kind === 4 && event.length === 2 && (a === 0 || a === 1)) g.autoFire = !!a;
    else throw new Error('Unknown replay event');
  }
  const status =
    g.status === 'clear' ? 'clear' : g.status === 'gameover' ? 'gameover' : 'abandoned';
  return {
    status,
    score: Math.floor(g.score),
    kills: g.kills,
    seconds: g.time,
    level: g.level,
    creditsUsed: g.creditsUsed,
    loadout: { ...g.loadout },
    frames,
  };
}
