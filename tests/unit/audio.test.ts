import { afterEach, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/core/audio/AudioEngine';

afterEach(() => vi.unstubAllGlobals());

it('plays full pickup cues even when collection happens during preloading', async () => {
  const start = vi.fn();
  let finishFetch!: (response: unknown) => void;
  const fetchSample = vi.fn(
    () =>
      new Promise((resolve) => {
        finishFetch = resolve;
      }),
  );
  const gain = () => ({ gain: { value: 0 }, connect: vi.fn() });
  vi.stubGlobal('fetch', fetchSample);
  vi.stubGlobal(
    'AudioContext',
    class {
      currentTime = 1;
      state = 'running';
      destination = {};
      createGain = gain;
      createOscillator = () => ({ connect: vi.fn(), start: vi.fn() });
      createBufferSource = () => ({ playbackRate: { value: 0 }, connect: vi.fn(), start });
      decodeAudioData = async () => ({
        duration: 3,
        sampleRate: 10,
        getChannelData: () => new Float32Array([0, 0, 0.5]),
      });
    },
  );
  const audio = new AudioEngine();
  await audio.unlock();
  audio.preload(['/audio/optionadd.mp3']);
  const first = audio.jingle('/audio/optionadd.mp3');
  const second = audio.jingle('/audio/optionadd.mp3');
  expect(start).not.toHaveBeenCalled();
  finishFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  await Promise.all([first, second]);
  expect(fetchSample).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledTimes(2);
  expect(start).toHaveBeenCalledWith(1, 0.2, 2.8);
});

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
