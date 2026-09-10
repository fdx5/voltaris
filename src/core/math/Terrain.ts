import { Random } from './Random';

/**
 * The scrolling ground of a surface stage.
 *
 * The height field is a sum of sine harmonics whose x frequencies are whole
 * multiples of the tile width, so the strip repeats exactly every `span` and
 * can be scrolled forever without a seam. It is pure maths with no allocation
 * per call: the simulation uses it to seat ground emplacements, and the
 * renderer uses the same numbers to build the mesh, so what you shoot is what
 * you see.
 */
export class Terrain {
  private readonly harmonic: Float32Array;
  private readonly amplitude: Float32Array;
  private readonly phase: Float32Array;
  private readonly total: number;
  constructor(
    /** Tile width. The field repeats exactly at this interval. */
    readonly span: number,
    /** Height of the valley floor. */
    readonly base: number,
    /** Height of the ridges above the floor. */
    readonly relief: number,
    seed = 60712,
    /**
     * How level the play lane is kept, from 0 (flat under the ship, full
     * relief at the edges) to 1 (the same relief everywhere). A cave roof
     * wants a high value: with the deck's setting the vault closes in on the
     * horizon and swallows the corridor the player flies down.
     */
    readonly lane = 0.45,
    /** How far the far range climbs past the relief. */
    readonly reach = 0.35,
  ) {
    const rng = new Random(seed);
    const waves = [1, 2, 3, 5, 8, 13];
    this.harmonic = new Float32Array(waves);
    this.amplitude = new Float32Array(waves.length);
    this.phase = new Float32Array(waves.length);
    let total = 0;
    for (let i = 0; i < waves.length; i++) {
      // Amplitude falls off with frequency: broad hills carrying fine detail.
      this.amplitude[i] = 1 / Math.pow(waves[i], 0.85);
      this.phase[i] = rng.next() * Math.PI * 2;
      total += this.amplitude[i];
    }
    this.total = total;
  }
  /** Ground height at a point, in world units. */
  height(x: number, z: number) {
    const k = (Math.PI * 2) / this.span;
    let sum = 0;
    for (let i = 0; i < this.harmonic.length; i++) {
      // The z term bends each ridge as it recedes, so the field reads as
      // terrain rather than as extruded corrugations.
      const bend = Math.sin(z * 0.085 + this.phase[i] * 1.7) * 1.25;
      sum += this.amplitude[i] * Math.sin(k * this.harmonic[i] * x + this.phase[i] + bend);
    }
    const rolling = sum / this.total / 2 + 0.5;
    // The play lane stays comparatively level so emplacements sit flat and
    // the eye reads the near dunes and the far range as the relief.
    // The lane is only partly flattened now: emplacements still sit level
    // enough to read, but the ground under them visibly rises and falls.
    const lane = this.lane + (1 - this.lane) * Math.min(1, Math.abs(z) / 15) ** 1.4;
    // The far range is capped: an uncapped ramp put the horizon in the middle
    // of the play field instead of behind it.
    const range = Math.min(1, Math.max(0, (-z - 12) / 30));
    return this.base + rolling * this.relief * lane + range * range * this.relief * this.reach;
  }
}
