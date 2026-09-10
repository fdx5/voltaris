/**
 * Persistent synth voices for the effects that can be synthesised, plus a
 * decoded-sample path for recorded weapon fire and a streamed stage track.
 * The synth voices allocate nothing; a recorded weapon costs one short-lived
 * source node per shot, capped at ten concurrent voices.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: OscillatorNode[] = [];
  private gains: GainNode[] = [];
  private cursor = 0;
  private nextBeat = 0;
  private beat = 0;
  private lastShot = 0;
  /** Streamed stage track. Kept off the AudioContext graph so a 4 MB file
   *  never has to be decoded into memory up front. */
  private music: HTMLAudioElement | null = null;
  private trackWanted = false;
  volume = 0.5;
  musicVolume = 0.5;
  muted = false;
  async unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      for (let i = 0; i < 24; i++) {
        const osc = this.ctx.createOscillator(),
          gain = this.ctx.createGain();
        osc.type = i < 16 ? 'triangle' : i < 20 ? 'sawtooth' : 'sine';
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(this.master);
        osc.start();
        this.voices.push(osc);
        this.gains.push(gain);
      }
      this.nextBeat = this.ctx.currentTime;
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }
  setVolume(volume: number) {
    this.volume = volume;
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(this.muted ? 0 : volume, this.ctx.currentTime, 0.05);
    this.applyMusicGain();
  }
  setMusicVolume(volume: number) {
    this.musicVolume = volume;
    this.applyMusicGain();
  }
  toggle() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
  }
  private applyMusicGain() {
    // Independent of the effect bus so the slider reading is the level the
    // player actually hears; the mute button still cuts both.
    if (this.music) this.music.volume = this.muted ? 0 : this.musicVolume;
  }
  /** Starts (or switches to) a looping stage track. Safe to call repeatedly. */
  playTrack(url: string) {
    if (!this.music) {
      this.music = new Audio();
      this.music.loop = true;
      this.music.preload = 'auto';
    }
    const absolute = new URL(url, location.href).href;
    if (this.music.src !== absolute) this.music.src = absolute;
    this.trackWanted = true;
    this.applyMusicGain();
    void this.music.play().catch(() => {});
  }
  stopTrack() {
    this.trackWanted = false;
    if (!this.music) return;
    this.music.pause();
    this.music.currentTime = 0;
  }
  /**
   * Decoded weapon samples, with the leading silence of each measured once so
   * a shot is heard the instant it is fired.
   */
  private readonly samples = new Map<string, { buffer: AudioBuffer; onset: number }>();
  private readonly sampleBusy = new Set<string>();
  private weaponBus: GainNode | null = null;
  private weaponVoices = 0;
  private impactBus: GainNode | null = null;
  private impactVoices = 0;

  /**
   * Fires one voice of a weapon sample. Called once per shot, so at a laser's
   * cadence the voices overlap into a continuous beam rather than a stutter.
   * Each voice is capped at 400 ms: a firing sample is a transient, and the
   * seconds of silence most of them carry would otherwise pile up as live
   * nodes.
   */
  fireSample(url: string) {
    this.playSample(url, 'weapon');
  }
  /** One-shot for a wreck. Longer than a weapon voice and on its own bus. */
  impactSample(url: string) {
    this.playSample(url, 'impact');
  }
  /**
   * A full-length cue such as the stage-clear fanfare. Unlike combat voices it
   * is never truncated and never refused for polyphony, because there is only
   * ever one of it.
   */
  async jingle(url: string) {
    // A cue fires once, so it cannot afford to be skipped while its sample
    // decodes the way a repeating combat voice can.
    if (!this.samples.has(url)) await this.loadSample(url);
    this.playSample(url, 'impact', true);
  }
  /** Decodes samples up front so the first use of each is not silent. */
  preload(urls: readonly string[]) {
    for (const url of urls) if (!this.samples.has(url)) void this.loadSample(url);
  }
  private playSample(url: string, bus: 'weapon' | 'impact', whole = false) {
    const entry = this.samples.get(url);
    if (!entry) {
      void this.loadSample(url);
      return;
    }
    const weapon = bus === 'weapon';
    const output = weapon ? this.weaponBus : this.impactBus;
    // Wrecks come in waves, so both buses cap their polyphony rather than
    // letting a big formation stack into a wall of noise.
    const busy = weapon ? this.weaponVoices : this.impactVoices;
    if (!this.ctx || !output || (!whole && busy >= (weapon ? 10 : 8))) return;
    const node = this.ctx.createBufferSource();
    node.buffer = entry.buffer;
    // A touch of detune keeps a repeated sample from sounding mechanical.
    // A one-off cue plays at pitch; repeated combat voices get detuned.
    node.playbackRate.value = whole
      ? 1
      : (weapon ? 0.97 : 0.9) + Math.random() * (weapon ? 0.06 : 0.22);
    node.connect(output);
    if (weapon) this.weaponVoices++;
    else this.impactVoices++;
    node.onended = () => {
      if (weapon) this.weaponVoices--;
      else this.impactVoices--;
      node.disconnect();
    };
    const remaining = entry.buffer.duration - entry.onset;
    const length = whole ? remaining : Math.min(remaining, weapon ? 0.4 : 1.6);
    node.start(this.ctx.currentTime, entry.onset, length);
  }
  private async loadSample(url: string) {
    if (!this.ctx || !this.master || this.sampleBusy.has(url)) return;
    this.sampleBusy.add(url);
    try {
      const bytes = await (await fetch(url)).arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(bytes);
      const data = buffer.getChannelData(0);
      const scan = Math.min(data.length, buffer.sampleRate);
      let onset = 0;
      for (let i = 0; i < scan; i++)
        if (Math.abs(data[i]) > 0.01) {
          onset = i / buffer.sampleRate;
          break;
        }
      if (!this.weaponBus) {
        // Overlapping voices stack, so the buses sit well below unity.
        this.weaponBus = this.ctx.createGain();
        this.weaponBus.gain.value = 0.32;
        this.weaponBus.connect(this.master);
        this.impactBus = this.ctx.createGain();
        this.impactBus.gain.value = 0.5;
        this.impactBus.connect(this.master);
      }
      this.samples.set(url, { buffer, onset });
    } catch {
      // A missing or undecodable sample just leaves that weapon on the synth.
    } finally {
      this.sampleBusy.delete(url);
    }
  }
  private tone(f: number, duration: number, gain: number, end = f, voice = -1) {
    if (!this.ctx) return;
    const i = voice >= 0 ? voice : this.cursor++ % 16,
      now = this.ctx.currentTime,
      osc = this.voices[i],
      amp = this.gains[i].gain;
    osc.frequency.cancelScheduledValues(now);
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), now + duration);
    amp.cancelScheduledValues(now);
    amp.setValueAtTime(0.0001, now);
    amp.linearRampToValueAtTime(gain, now + 0.007);
    amp.exponentialRampToValueAtTime(0.0001, now + duration);
  }
  shot() {
    if (!this.ctx || this.ctx.currentTime - this.lastShot < 0.085) return;
    this.lastShot = this.ctx.currentTime;
    this.tone(1350, 0.085, 0.04, 400);
  }
  explosion() {
    this.tone(125, 0.3, 0.2, 23);
    this.tone(73, 0.4, 0.15, 20);
  }
  pickup() {
    this.tone(660, 0.18, 0.15, 1320);
  }
  warning() {
    this.tone(220, 0.4, 0.2, 330);
  }
  private notes = [0, 7, 12, 7, 3, 10, 15, 10, 5, 12, 17, 12, 3, 10, 15, 19];
  tick(active: boolean, boss: boolean) {
    if (this.trackWanted) return;
    if (!this.ctx || this.ctx.state !== 'running' || !active) return;
    const now = this.ctx.currentTime;
    if (now < this.nextBeat) return;
    this.nextBeat = now + (boss ? 0.115 : 0.14);
    const f = 110 * Math.pow(2, this.notes[this.beat % 16] / 12);
    this.tone(f, 0.17, 0.055, f, 16 + (this.beat % 4));
    if (this.beat % 4 === 0) this.tone(90, 0.16, 0.24, 25, 20);
    if (this.beat % 8 === 4) this.tone(180, 0.09, 0.08, 65, 21);
    this.beat++;
  }
  suspend() {
    void this.ctx?.suspend();
    this.music?.pause();
  }
  resume() {
    if (this.ctx) {
      this.nextBeat = this.ctx.currentTime;
      void this.ctx.resume();
    }
    if (this.trackWanted) void this.music?.play().catch(() => {});
  }
  dispose() {
    void this.ctx?.close();
    this.stopTrack();
    this.music?.removeAttribute('src');
    this.music = null;
  }
}
