/** État des commandes tactiles multi-doigts (Pointer Events). */
export type TouchAction = 'left' | 'right' | 'drift' | 'brake';

export class MultiTouchControls {
  private readonly pointers = new Map<number, TouchAction>();

  press(pointerId: number, action: TouchAction) {
    this.pointers.set(pointerId, action);
  }

  release(pointerId: number) {
    return this.pointers.delete(pointerId);
  }

  isDown(action: TouchAction) {
    for (const held of this.pointers.values()) if (held === action) return true;
    return false;
  }

  get steer() {
    const left = this.isDown('left');
    const right = this.isDown('right');
    return left === right ? 0 : left ? -1 : 1;
  }

  get drift() {
    return this.isDown('drift');
  }

  get brake() {
    return this.isDown('brake');
  }

  clear() {
    this.pointers.clear();
  }

  get activePointerCount() {
    return this.pointers.size;
  }
}
