import { afterEach, expect, it, vi } from 'vitest';
import { Runtime } from '../../src/core/Runtime';
import { AudioEngine } from '../../src/core/audio/AudioEngine';
import { useAccount } from '../../src/ui/store/useAccount';

afterEach(() => {
  vi.unstubAllGlobals();
  useAccount.setState({ launching: false, error: '' });
});

it('plays the media element in the launch gesture even while the server is pending', async () => {
  vi.stubGlobal('AudioContext', undefined);
  vi.stubGlobal('webkitAudioContext', undefined);
  vi.stubGlobal('location', { href: 'https://game.example/' });
  let gesture = true;
  const play = vi.fn(() => {
    expect(gesture).toBe(true);
    return Promise.resolve();
  });
  const pause = vi.fn();
  vi.stubGlobal(
    'Audio',
    class {
      src = '';
      paused = true;
      play = play;
      pause = pause;
      setAttribute = vi.fn();
    },
  );
  let reject!: (reason: Error) => void;
  const pending = new Promise<void>((_, fail) => {
    reject = fail;
  });
  const runtime = {
    audio: new AudioEngine(),
    finishRun: () => pending,
  } as unknown as Runtime;
  const starting = Runtime.prototype.start.call(runtime, 'LASER', 3, false, false, 0);
  expect(play).toHaveBeenCalledOnce();
  expect(useAccount.getState().launching).toBe(true);
  gesture = false;
  reject(new Error('Server unavailable'));
  await expect(starting).rejects.toThrow('Server unavailable');
  expect(pause).toHaveBeenCalledOnce();
  expect(useAccount.getState().launching).toBe(false);
});
