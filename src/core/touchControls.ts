/** État des commandes tactiles multi-doigts (Pointer Events & React Native). */
export type TouchAction = 'left' | 'right' | 'drift' | 'brake' | 'fire';
export type TouchZoneId = TouchAction | 'pause';

export interface TouchZoneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TouchPointSample {
  identifier: number;
  pageX: number;
  pageY: number;
}

export class MultiTouchControls {
  private readonly pointers = new Map<number, TouchAction>();

  press(pointerId: number, action: TouchAction) {
    this.pointers.set(pointerId, action);
  }

  release(pointerId: number) {
    return this.pointers.delete(pointerId);
  }

  releaseAction(action: TouchAction) {
    for (const [id, held] of Array.from(this.pointers.entries())) {
      if (held === action) this.pointers.delete(id);
    }
  }

  /** Supprime tout identifiant de pointeur qui n'apparaît plus dans la liste active du système. */
  pruneToActive(activePointerIds: Iterable<number>) {
    const alive = new Set<number>();
    for (const id of activePointerIds) alive.add(id);
    for (const id of Array.from(this.pointers.keys())) {
      if (!alive.has(id)) this.pointers.delete(id);
    }
  }

  actionFor(pointerId: number) {
    return this.pointers.get(pointerId) ?? null;
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

/**
 * Routeur multi-doigts par zones écran (coordonnées `RootView` / `pageX,pageY`).
 *
 * Sur Android (React Native Paper / `JSTouchDispatcher`), `ACTION_POINTER_DOWN`
 * et `ACTION_POINTER_UP` sont routés vers la vue touchée par le PREMIER doigt :
 * des écouteurs isolés par bouton manquent donc le 2ᵉ pouce (ex. direction +
 * dérapage, ou direction + pause) et peuvent laisser le 1ᵉʳ bouton coincé.
 * Ce contrôleur résout chaque pointeur par ses coordonnées dans un conteneur parent.
 */
export class TouchZoneController {
  readonly controls = new MultiTouchControls();
  private readonly zones = new Map<TouchZoneId, TouchZoneRect>();

  setZone(id: TouchZoneId, rect: TouchZoneRect | null) {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      this.zones.delete(id);
      if (id !== 'pause') this.controls.releaseAction(id);
      return;
    }
    this.zones.set(id, rect);
  }

  hitTest(pageX: number, pageY: number, slop = 6, includePause = true): TouchZoneId | null {
    if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) return null;
    let best: TouchZoneId | null = null;
    let bestDistSq = Infinity;
    for (const [id, r] of this.zones.entries()) {
      if (!includePause && id === 'pause') continue;
      if (
        pageX >= r.left - slop &&
        pageX <= r.left + r.width + slop &&
        pageY >= r.top - slop &&
        pageY <= r.top + r.height + slop
      ) {
        const cx = r.left + r.width * 0.5;
        const cy = r.top + r.height * 0.5;
        const dSq = (pageX - cx) * (pageX - cx) + (pageY - cy) * (pageY - cy);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          best = id;
        }
      }
    }
    return best;
  }

  handleTouchStart(changedTouches: readonly TouchPointSample[], allTouches?: readonly TouchPointSample[]): 'pause' | null {
    if (allTouches) {
      const activeIds = new Set<number>(allTouches.map((t) => t.identifier));
      for (const t of changedTouches) activeIds.add(t.identifier);
      this.controls.pruneToActive(activeIds);
    }
    for (const t of changedTouches) {
      const zone = this.hitTest(t.pageX, t.pageY, 6, true);
      if (zone === 'pause') {
        this.controls.clear();
        return 'pause';
      }
      if (zone) {
        this.controls.press(t.identifier, zone);
      } else {
        this.controls.release(t.identifier);
      }
    }
    return null;
  }

  handleTouchMove(changedTouches: readonly TouchPointSample[], allTouches?: readonly TouchPointSample[]) {
    if (allTouches) {
      this.controls.pruneToActive(allTouches.map((t) => t.identifier));
    }
    for (const t of changedTouches) {
      const current = this.controls.actionFor(t.identifier);
      const slop = current ? 12 : 6;
      const zone = this.hitTest(t.pageX, t.pageY, slop, false);
      if (zone && zone !== 'pause') {
        this.controls.press(t.identifier, zone);
      } else if (current) {
        this.controls.release(t.identifier);
      }
    }
  }

  handleTouchEnd(changedTouches: readonly TouchPointSample[], allTouches?: readonly TouchPointSample[]) {
    for (const t of changedTouches) {
      this.controls.release(t.identifier);
    }
    if (allTouches) {
      this.controls.pruneToActive(allTouches.map((t) => t.identifier));
    }
  }

  handleTouchCancel() {
    this.controls.clear();
  }

  clear() {
    this.controls.clear();
  }

  get steer() {
    return this.controls.steer;
  }

  get left() {
    return this.controls.isDown('left');
  }

  get right() {
    return this.controls.isDown('right');
  }

  get drift() {
    return this.controls.drift;
  }

  get brake() {
    return this.controls.brake;
  }

  get activePointerCount() {
    return this.controls.activePointerCount;
  }
}
