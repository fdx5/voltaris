import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputManager, Key } from '../../src/core/input/InputManager';

class Surface extends EventTarget {
  captured = new Set<number>();
  closest() {
    return null;
  }
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
  hasPointerCapture(id: number) {
    return this.captured.has(id);
  }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
  }
}
function pointer(
  target: EventTarget,
  type: string,
  id: number,
  x = 100,
  y = 100,
  source?: unknown,
) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0 });
  if (source) Object.defineProperty(event, 'target', { value: source });
  target.dispatchEvent(event);
}
let surface: Surface, win: Surface, input: InputManager, enabled: boolean;
beforeEach(() => {
  surface = new Surface();
  win = new Surface();
  enabled = true;
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', Object.assign(new Surface(), { hidden: false }));
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  vi.stubGlobal('innerWidth', 932);
  vi.stubGlobal('innerHeight', 430);
  input = new InputManager(surface as unknown as HTMLElement, () => enabled);
});
afterEach(() => {
  input.dispose();
  vi.unstubAllGlobals();
});
describe('flight pointer ownership and recovery', () => {
  it('accepts canvas descendants and the right side of the screen', () => {
    pointer(surface, 'pointerdown', 1, 800, 100, { closest: () => null });
    pointer(win, 'pointermove', 1, 820, 120);
    input.flush();
    expect(input.dx).toBeGreaterThan(0);
    expect(input.dy).toBeLessThan(0);
  });
  it('does not let another finger steal steering and hands off without jumping', () => {
    pointer(surface, 'pointerdown', 1);
    pointer(surface, 'pointerdown', 2, 600, 300);
    pointer(win, 'pointermove', 2, 700, 300);
    input.flush();
    expect(input.dx).toBe(0);
    pointer(win, 'pointermove', 1, 120, 100);
    input.flush();
    expect(input.dx).toBeGreaterThan(0);
    pointer(win, 'pointerup', 1);
    input.flush();
    expect(input.dx).toBe(0);
    pointer(win, 'pointermove', 2, 710, 300);
    input.flush();
    expect(input.dx).toBeCloseTo((10 * 18) / 430);
  });
  it.each(['pointercancel'])('recovers after %s', (type) => {
    pointer(surface, 'pointerdown', 1);
    pointer(type === 'lostpointercapture' ? surface : win, type, 1);
    pointer(win, 'pointermove', 1, 700);
    input.flush();
    expect(input.dx).toBe(0);
    pointer(surface, 'pointerdown', 2);
    pointer(win, 'pointermove', 2, 130);
    input.flush();
    expect(input.dx).toBeGreaterThan(0);
  });
  it('keeps steering after capture loss until the finger actually releases', () => {
    pointer(surface, 'pointerdown', 1);
    pointer(surface, 'lostpointercapture', 1);
    pointer(win, 'pointermove', 1, 130);
    input.flush();
    expect(input.dx).toBeGreaterThan(0);
    pointer(win, 'pointerup', 1);
    pointer(win, 'pointermove', 1, 160);
    input.flush();
    expect(input.dx).toBe(0);
  });
  it('tracks on the window if capture fails and ignores UI controls', () => {
    surface.setPointerCapture = () => {
      throw new Error('capture unavailable');
    };
    pointer(surface, 'pointerdown', 1, 100, 100, { closest: () => ({}) });
    pointer(win, 'pointermove', 1, 150);
    input.flush();
    expect(input.dx).toBe(0);
    pointer(surface, 'pointerdown', 2);
    pointer(win, 'pointermove', 2, 150);
    input.flush();
    expect(input.dx).toBeGreaterThan(0);
  });
  it('clears movement on pause/blur and bounds accumulated movement for replay', () => {
    pointer(surface, 'pointerdown', 1);
    pointer(win, 'pointermove', 1, 100000, 100000);
    input.flush();
    expect(input.dx).toBe(32);
    expect(input.dy).toBe(-18);
    enabled = false;
    pointer(win, 'pointermove', 1, 0, 0);
    input.flush();
    expect(input.dx).toBe(0);
    enabled = true;
    pointer(surface, 'pointerdown', 2);
    pointer(win, 'pointermove', 2, 150);
    win.dispatchEvent(new Event('blur'));
    input.flush();
    expect(input.dx).toBe(0);
    expect(surface.captured.size).toBe(0);
  });
  it('keeps hold active until every hold finger releases, then clears on interruption', () => {
    input.set(Key.Hold, true, 5);
    input.set(Key.Hold, true, 6);
    input.set(Key.Hold, false, 5);
    input.flush();
    expect(input.bits & Key.Hold).toBeTruthy();
    input.set(Key.Hold, false, 6);
    input.flush();
    expect(input.bits & Key.Hold).toBe(0);
    input.set(Key.Hold, true, 7);
    input.clear();
    input.flush();
    expect(input.bits).toBe(0);
  });
});
