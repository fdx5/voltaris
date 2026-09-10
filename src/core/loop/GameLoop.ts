const STEP = 1 / 60;
export class GameLoop {
  private handle = 0;
  private last = 0;
  private accumulator = 0;
  fps = 60;
  frameMs = 0;
  private frames = 0;
  private elapsed = 0;
  constructor(
    private tick: (dt: number) => void,
    private render: (alpha: number, dt: number) => void,
  ) {}
  private frame = (now: number) => {
    const raw = this.last ? (now - this.last) / 1000 : STEP,
      dt = Math.min(raw, 0.1);
    this.last = now;
    this.accumulator += dt;
    while (this.accumulator >= STEP) {
      this.tick(STEP);
      this.accumulator -= STEP;
    }
    this.render(this.accumulator / STEP, dt);
    this.frames++;
    this.elapsed += raw;
    if (this.elapsed >= 0.5) {
      this.fps = this.frames / this.elapsed;
      this.frameMs = (this.elapsed * 1000) / this.frames;
      this.frames = 0;
      this.elapsed = 0;
    }
    this.handle = requestAnimationFrame(this.frame);
  };
  start() {
    if (!this.handle) this.handle = requestAnimationFrame(this.frame);
  }
  stop() {
    cancelAnimationFrame(this.handle);
    this.handle = 0;
    this.last = 0;
    this.accumulator = 0;
  }
}
