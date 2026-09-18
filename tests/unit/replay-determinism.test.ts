import { describe, it, expect } from 'vitest';
import { GameState } from '../../src/game/GameState';
import { verifyReplay } from '../../server/replay';

/**
 * The server never re-runs a client's live session - it re-simulates the
 * recorded input through a fresh GameState (server/replay.ts) and trusts
 * that result instead. If that re-simulation ever disagrees with what the
 * player's own client actually reached, a legitimate clear gets rejected as
 * CLEAR_VERIFICATION_FAILED with no way for the player to tell why. This
 * plays a full, unscripted session per stage - autofire only, no input
 * cheats, real deaths and real continues - and checks the two simulations
 * agree exactly. See voltaris-render-outage/enemy-mixing memory notes for
 * the incident that prompted this: the actual cause was never found (this
 * suite passed cleanly against every gameplay change made that day), but
 * nothing already this cheap to check should go unchecked going forward.
 */
function simulate(stageIndex: number) {
  const g = new GameState();
  g.start('MISSILE', 3, false, false, stageIndex);
  g.autoFire = true;
  const events: number[][] = [];
  let ticks = 0,
    continuesUsed = 0;
  const MAX_TICKS = 60 * 60 * 15;
  while (ticks < MAX_TICKS) {
    if (g.status === 'gameover' || g.status === 'clear') break;
    if (g.status === 'continue') {
      // A real player's reaction time before clicking continue.
      for (let w = 0; w < 30 && g.status === 'continue'; w++) {
        events.push([0, 0, 0, 0, 0]);
        g.tick(1 / 60, 0, 0, 0, 0);
        ticks++;
      }
      if (g.status === 'continue' && continuesUsed < 2) {
        events.push([3]);
        g.continueRun();
        continuesUsed++;
      }
      continue;
    }
    const dx = Math.sin(ticks / 91) * 0.02,
      dy = Math.cos(ticks / 131) * 0.02;
    events.push([0, 0, 0, dx, dy]);
    g.tick(1 / 60, 0, 0, dx, dy);
    ticks++;
  }
  return { g, events, ticks };
}
describe('server replay re-simulation matches the live client', () => {
  it.each([0, 1, 2, 3, 4])('stage index %i', (stageIndex) => {
    const { g, events } = simulate(stageIndex);
    const result = verifyReplay(
      { weapon: 'MISSILE', credits: 3, practice: false, stage: stageIndex + 1, autoFire: true },
      events,
    );
    const liveStatus = g.status === 'clear' ? 'clear' : g.status === 'gameover' ? 'gameover' : 'abandoned';
    expect(result.status).toBe(liveStatus);
    expect(result.score).toBe(Math.floor(g.score));
    expect(result.kills).toBe(g.kills);
    expect(result.creditsUsed).toBe(g.creditsUsed);
  }, 60000);
});
