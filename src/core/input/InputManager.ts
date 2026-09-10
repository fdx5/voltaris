export enum Key {
  Left = 1,
  Right = 2,
  Up = 4,
  Down = 8,
  Fire = 16,
  Hold = 32,
  Skill1 = 64,
  Skill2 = 128,
  Skill3 = 256,
  Mode = 512,
  Pause = 1024,
}
const codes: Record<string, Key> = {
  ArrowLeft: Key.Left,
  KeyA: Key.Left,
  ArrowRight: Key.Right,
  KeyD: Key.Right,
  ArrowUp: Key.Up,
  KeyW: Key.Up,
  ArrowDown: Key.Down,
  KeyS: Key.Down,
  KeyZ: Key.Fire,
  Space: Key.Fire,
  ShiftLeft: Key.Hold,
  ShiftRight: Key.Hold,
  Digit1: Key.Skill1,
  Digit2: Key.Skill2,
  Digit3: Key.Skill3,
  KeyQ: Key.Mode,
  Escape: Key.Pause,
};
export class InputManager {
  bits = 0;
  pressed = 0;
  dx = 0;
  dy = 0;
  sensitivity = 1;
  gamepad = false;
  private pending = 0;
  private keyboard = 0;
  private virtual = 0;
  private last = 0;
  private drag = -1;
  private x = 0;
  private y = 0;
  private mx = 0;
  private my = 0;
  private controller = new AbortController();
  constructor(element: HTMLElement) {
    const signal = this.controller.signal;
    window.addEventListener(
      'keydown',
      (e) => {
        if ((e.target as HTMLElement).matches('input,select,textarea')) return;
        const b = codes[e.code];
        if (b) {
          e.preventDefault();
          if (!e.repeat) this.pending |= b;
          this.keyboard |= b;
        }
      },
      { signal },
    );
    window.addEventListener(
      'keyup',
      (e) => {
        this.keyboard &= ~(codes[e.code] ?? 0);
      },
      { signal },
    );
    window.addEventListener('blur', () => this.clear(), { signal });
    element.addEventListener(
      'pointerdown',
      (e) => {
        if (e.target !== element || e.clientX > innerWidth * 0.65) return;
        e.preventDefault();
        this.drag = e.pointerId;
        this.x = e.clientX;
        this.y = e.clientY;
        element.setPointerCapture(e.pointerId);
      },
      { signal },
    );
    element.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerId !== this.drag) return;
        this.mx += e.clientX - this.x;
        this.my += e.clientY - this.y;
        this.x = e.clientX;
        this.y = e.clientY;
      },
      { signal },
    );
    const up = (e: PointerEvent) => {
      if (e.pointerId === this.drag) this.drag = -1;
    };
    element.addEventListener('pointerup', up, { signal });
    element.addEventListener('pointercancel', up, { signal });
  }
  set(key: Key, on: boolean) {
    if (on) this.virtual |= key;
    else this.virtual &= ~key;
  }
  flush() {
    let padBits = 0;
    const pads = navigator.getGamepads?.();
    this.gamepad = false;
    if (pads)
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (!p) continue;
        this.gamepad = true;
        const a = p.axes;
        if (a[0] < -0.2 || p.buttons[14]?.pressed) padBits |= Key.Left;
        if (a[0] > 0.2 || p.buttons[15]?.pressed) padBits |= Key.Right;
        if (a[1] < -0.2 || p.buttons[12]?.pressed) padBits |= Key.Up;
        if (a[1] > 0.2 || p.buttons[13]?.pressed) padBits |= Key.Down;
        if (p.buttons[0]?.pressed) padBits |= Key.Fire;
        if (p.buttons[5]?.pressed) padBits |= Key.Hold;
        if (p.buttons[2]?.pressed) padBits |= Key.Skill1;
        if (p.buttons[3]?.pressed) padBits |= Key.Skill2;
        if (p.buttons[1]?.pressed) padBits |= Key.Skill3;
        if (p.buttons[9]?.pressed) padBits |= Key.Pause;
        break;
      }
    this.bits = this.keyboard | this.virtual | padBits;
    this.pressed = (this.bits & ~this.last) | this.pending;
    this.pending = 0;
    this.last = this.bits;
    const scale = 18 / Math.min(innerHeight, (innerWidth * 9) / 16);
    this.dx = this.mx * scale * this.sensitivity;
    this.dy = -this.my * scale * this.sensitivity;
    this.mx = this.my = 0;
  }
  clear() {
    this.pending = this.keyboard = this.virtual = this.bits = this.pressed = this.last = 0;
    this.dx = this.dy = this.mx = this.my = 0;
    this.drag = -1;
  }
  dispose() {
    this.controller.abort();
  }
}
