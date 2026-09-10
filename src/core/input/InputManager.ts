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
  private virtualPointers = new Map<number, Key>();
  private last = 0;
  private drag = -1;
  private pointers = new Map<number, { x: number; y: number }>();
  private mx = 0;
  private my = 0;
  private controller = new AbortController();
  constructor(
    private element: HTMLElement,
    private canMove: () => boolean = () => true,
  ) {
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
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.clear();
      },
      { signal },
    );
    const eligible = (e: PointerEvent) =>
      this.canMove() &&
      !(e.target as Element).closest(
        'button,input,select,textarea,a,[role="dialog"],[data-no-flight-input]',
      );
    const begin = (e: PointerEvent) => {
      if (!eligible(e) || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // A second finger must never steal the current steering finger.
      if (this.drag === -1) this.drag = e.pointerId;
      try {
        element.setPointerCapture(e.pointerId);
      } catch {
        /* Window listeners retain tracking. */
      }
    };
    element.addEventListener('pointerdown', begin, { signal, passive: false });
    window.addEventListener(
      'pointermove',
      (e) => {
        const point = this.pointers.get(e.pointerId);
        if (!point) return;
        if (!this.canMove()) {
          this.clear();
          return;
        }
        if (e.cancelable) e.preventDefault();
        if (e.pointerId === this.drag) {
          this.mx += e.clientX - point.x;
          this.my += e.clientY - point.y;
        }
        point.x = e.clientX;
        point.y = e.clientY;
      },
      { signal, passive: false },
    );
    const end = (e: PointerEvent) => {
      this.virtualPointers.delete(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (e.pointerId === this.drag) {
        // Use the remaining finger's latest position; never jump on handoff.
        this.drag = this.pointers.keys().next().value ?? -1;
      }
      try {
        if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
      } catch {
        /* The browser may already have released a cancelled pointer. */
      }
    };
    window.addEventListener('pointerup', end, { signal });
    window.addEventListener('pointercancel', end, { signal });
    // Losing capture is not a release: window listeners keep the same finger
    // moving until pointerup/cancel. Dropping it here makes steering freeze.
    element.addEventListener(
      'contextmenu',
      (e) => {
        if (this.canMove()) e.preventDefault();
      },
      { signal },
    );
  }

  set(key: Key, on: boolean, pointerId?: number) {
    if (pointerId !== undefined) {
      if (on) this.virtualPointers.set(pointerId, key);
      else this.virtualPointers.delete(pointerId);
      return;
    }
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
    let touchBits = 0;
    for (const key of this.virtualPointers.values()) touchBits |= key;
    this.bits = this.keyboard | this.virtual | touchBits | padBits;
    this.pressed = (this.bits & ~this.last) | this.pending;
    this.pending = 0;
    this.last = this.bits;
    const scale = 18 / Math.min(innerHeight, (innerWidth * 9) / 16);
    this.dx = Math.max(-32, Math.min(32, this.mx * scale * this.sensitivity));
    this.dy = Math.max(-18, Math.min(18, -this.my * scale * this.sensitivity));
    this.mx = this.my = 0;
  }
  clear() {
    this.pending = this.keyboard = this.virtual = this.bits = this.pressed = this.last = 0;
    this.dx = this.dy = this.mx = this.my = 0;
    this.drag = -1;
    this.virtualPointers.clear();
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    for (const id of ids) {
      try {
        if (this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id);
      } catch {
        /* Capture may have been cancelled by the OS. */
      }
    }
  }
  dispose() {
    this.clear();
    this.controller.abort();
  }
}
