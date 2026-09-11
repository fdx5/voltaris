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
  const gains: { gain: { value: number }; connect: ReturnType<typeof vi.fn> }[] = [];
  const gain = () => {
    const node = { gain: { value: 0 }, connect: vi.fn() };
    gains.push(node);
    return node;
  };
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
  const first = audio.pickupSample('/audio/optionadd.mp3', 2.4);
  const second = audio.pickupSample('/audio/optionadd.mp3', 2.4);
  expect(start).not.toHaveBeenCalled();
  finishFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  await Promise.all([first, second]);
  expect(fetchSample).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledTimes(2);
  expect(start).toHaveBeenCalledWith(1, 0.2, 2.8);
  const pickupGains = gains.filter((node) => node.gain.value === 2.4);
  expect(pickupGains).toHaveLength(2);
  // Both cues reach the independent unity bus, not the 0.5 explosion bus.
  for (const node of pickupGains)
    expect(node.connect).toHaveBeenCalledWith(expect.objectContaining({ gain: { value: 1 } }));
  await audio.jingle('/audio/optionadd.mp3', 3);
  expect(start).toHaveBeenLastCalledWith(1, 0, 3);
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
