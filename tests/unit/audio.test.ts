import { afterEach, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/core/audio/AudioEngine';

afterEach(() => vi.unstubAllGlobals());

it('does not reject launch when Web Audio is unavailable', async () => {
  vi.stubGlobal('AudioContext', undefined);
  vi.stubGlobal('webkitAudioContext', undefined);
  const audio = new AudioEngine();
  await expect(audio.unlock()).resolves.toBeUndefined();
  expect(() => {
    audio.resume();
    audio.suspend();
    audio.dispose();
  }).not.toThrow();
});

it('does not reject launch when the audio device refuses initialization', async () => {
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        throw new Error('Device unavailable');
      }
    },
  );
  await expect(new AudioEngine().unlock()).resolves.toBeUndefined();
});
