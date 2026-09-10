export class Random {
  constructor(public seed = 0x1a2b3c4d) {}
  next() {
    let n = this.seed;
    n ^= n << 13;
    n ^= n >>> 17;
    n ^= n << 5;
    this.seed = n >>> 0;
    return this.seed / 4294967296;
  }
}
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
