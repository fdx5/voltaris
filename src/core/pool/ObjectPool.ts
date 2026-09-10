/** Fixed-capacity SoA storage. Allocation and release never allocate JS objects. */
export class ObjectPool {
  readonly active: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly type: Uint8Array;
  readonly radius: Float32Array;
  readonly hp: Float32Array;
  readonly aux: Float32Array;
  private readonly free: Int32Array;
  private top = 0;
  count = 0;
  constructor(readonly capacity: number) {
    this.active = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.type = new Uint8Array(capacity);
    this.radius = new Float32Array(capacity);
    this.hp = new Float32Array(capacity);
    this.aux = new Float32Array(capacity);
    this.free = new Int32Array(capacity);
    this.clear();
  }
  clear() {
    this.active.fill(0);
    this.count = 0;
    this.top = this.capacity;
    for (let i = 0; i < this.capacity; i++) this.free[i] = this.capacity - 1 - i;
  }
  acquire(x: number, y: number, vx = 0, vy = 0, type = 0, life = 8, radius = 0.15, hp = 1) {
    if (!this.top) return -1;
    const i = this.free[--this.top];
    this.active[i] = 1;
    this.x[i] = this.px[i] = x;
    this.y[i] = this.py[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.type[i] = type;
    this.age[i] = 0;
    this.life[i] = life;
    this.radius[i] = radius;
    this.hp[i] = hp;
    this.aux[i] = 0;
    this.count++;
    return i;
  }
  release(i: number) {
    if (!this.active[i]) return;
    this.active[i] = 0;
    this.free[this.top++] = i;
    this.count--;
  }
  move(dt: number) {
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue;
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.age[i] += dt;
      if (this.age[i] > this.life[i]) this.release(i);
    }
  }
}
