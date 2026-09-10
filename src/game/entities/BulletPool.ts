import { ObjectPool } from '../../core/pool/ObjectPool';

/**
 * Hostile projectile families. `type` still separates the factions
 * (0 player, 1 hostile, 2 player homing missile); `kind` picks the flight
 * behaviour and the instanced batch a hostile shot is drawn in.
 */
export const Shot = {
  ORB: 0,
  NEEDLE: 1,
  WAVE: 2,
  ACCEL: 3,
  HOMING: 4,
  PULSE: 5,
  SPLIT: 6,
  BOUNCE: 7,
  SHARD: 8,
  PLASMA: 9,
} as const;
export const SHOT_KINDS = 10;

export class BulletPool extends ObjectPool {
  readonly grazed: Uint8Array;
  readonly lastHit: Int32Array;
  /** Hostile flight behaviour + draw batch. Always 0 for player shots. */
  readonly kind: Uint8Array;
  /** Launch heading, kept so weaving shots can steer around their own axis. */
  readonly heading: Float32Array;
  /** Per-kind scratch: cruise speed, split timer, bounces left, spin rate. */
  readonly param: Float32Array;
  constructor(capacity = 4096) {
    super(capacity);
    this.grazed = new Uint8Array(capacity);
    this.lastHit = new Int32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.heading = new Float32Array(capacity);
    this.param = new Float32Array(capacity);
  }
  fire(
    x: number,
    y: number,
    vx: number,
    vy: number,
    type: number,
    radius = 0.15,
    damage = 1,
    pierce = 1,
    kind = 0,
    param = 0,
  ) {
    const i = this.acquire(x, y, vx, vy, type, 12, radius, damage);
    if (i >= 0) {
      this.grazed[i] = 0;
      this.lastHit[i] = -1;
      this.aux[i] = pierce;
      this.kind[i] = kind;
      this.heading[i] = Math.atan2(vy, vx);
      this.param[i] = param;
    }
    return i;
  }
}
