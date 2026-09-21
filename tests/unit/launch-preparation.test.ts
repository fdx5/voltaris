import { afterEach, expect, it, vi } from 'vitest';
import { Runtime } from '../../src/core/Runtime';
import { GameState } from '../../src/game/GameState';
import { useAccount } from '../../src/ui/store/useAccount';

afterEach(() => {
  vi.unstubAllGlobals();
  useAccount.setState({ launching: false, error: '' });
});

it.each([false, true])(
  'holds the simulation and server run until GPU preparation settles (failure=%s)',
  async (fail) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const preparation = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'run', config: {} })));
    vi.stubGlobal('fetch', fetch);
    const game = new GameState();
    const runtime = {
      game,
      audio: { unlock: vi.fn(), playTrack: vi.fn(), preload: vi.fn(), stopTrack: vi.fn() },
      finishRun: vi.fn(async () => {}),
      loop: { stop: vi.fn(), start: vi.fn() },
      visual: { prepareStage: vi.fn(() => preparation), sync: vi.fn(), render: vi.fn() },
      input: { clear: vi.fn() },
      pickupSounds: new Uint32Array(6),
      sounds: new Uint32Array(7),
      playStageTrack: vi.fn(),
      checkOrientation: vi.fn(),
      publish: vi.fn(),
    };
    const starting = Runtime.prototype.start.call(
      runtime as unknown as Runtime,
      'LASER',
      3,
      false,
      false,
      1,
    );
    await vi.waitFor(() =>
      expect(runtime.visual.prepareStage).toHaveBeenCalledWith(1, expect.any(Function)),
    );
    expect(runtime.loop.stop).toHaveBeenCalledOnce();
    expect(runtime.loop.start).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(runtime.game).toBe(game);
    expect(runtime.game.time).toBe(0);
    if (fail) {
      reject(new Error('Asset download failed'));
      await expect(starting).rejects.toThrow('Asset download failed');
      expect(fetch).not.toHaveBeenCalled();
      expect(runtime.game).toBe(game);
    } else {
      resolve();
      await starting;
      expect(fetch).toHaveBeenCalledOnce();
      expect(runtime.game.stageIndex).toBe(1);
      expect(runtime.game.time).toBe(0);
    }
    expect(runtime.loop.start).toHaveBeenCalledOnce();
    expect(runtime.visual.sync).toHaveBeenCalledOnce();
    expect(useAccount.getState().launching).toBe(false);
  },
);
