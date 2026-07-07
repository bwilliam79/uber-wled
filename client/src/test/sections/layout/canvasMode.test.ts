import { describe, it, expect } from 'vitest';
import {
  layoutReducer, initialLayoutState, type LayoutState, type LayoutEvent
} from '../../../sections/layout/canvasMode';

function run(events: LayoutEvent[], from: LayoutState = initialLayoutState): LayoutState {
  return events.reduce(layoutReducer, from);
}

describe('draw flow', () => {
  it('START_DRAW enters draw mode with no vertices (only from idle)', () => {
    const s = run([{ type: 'START_DRAW' }]);
    expect(s.mode).toEqual({ name: 'draw', vertices: [] });
    expect(run([{ type: 'START_DRAW' }], s).mode).toEqual({ name: 'draw', vertices: [] });
  });

  it('PLACE_VERTEX appends world points', () => {
    const s = run([
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 10, y: 10 }, shift: false },
      { type: 'PLACE_VERTEX', point: { x: 50, y: 12 }, shift: false }
    ]);
    expect(s.mode).toEqual({ name: 'draw', vertices: [{ x: 10, y: 10 }, { x: 50, y: 12 }] });
  });

  // Angle-snap (shift) and grid-snap are applied by the caller before
  // dispatch (LayoutSection's applyDrawSnap, which needs the current canvas
  // size/viewport to compute the correct grid step — see computeGridStep in
  // geometry.ts) — the reducer just stores whatever point it's given
  // verbatim, `shift` included only so it's available for other logic (none
  // currently). End-to-end angle/grid snapping is covered in
  // LayoutSection.test.tsx.
  it('PLACE_VERTEX stores the point verbatim regardless of the shift flag — snapping is the caller\'s job', () => {
    const s = run([
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 10, y: 10 }, shift: false },
      { type: 'PLACE_VERTEX', point: { x: 50, y: 11 }, shift: true }
    ]);
    expect(s.mode).toEqual({ name: 'draw', vertices: [{ x: 10, y: 10 }, { x: 50, y: 11 }] });
  });

  it('UNDO_VERTEX drops the last vertex and is a no-op on empty', () => {
    const base = run([
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 1, y: 1 }, shift: false }
    ]);
    const s1 = layoutReducer(base, { type: 'UNDO_VERTEX' });
    expect(s1.mode).toEqual({ name: 'draw', vertices: [] });
    expect(layoutReducer(s1, { type: 'UNDO_VERTEX' }).mode).toEqual({ name: 'draw', vertices: [] });
  });

  it('FINISH_DRAW with fewer than 2 distinct vertices stays in draw mode', () => {
    const s = run([
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 5, y: 5 }, shift: false },
      { type: 'FINISH_DRAW' }
    ]);
    expect(s.mode.name).toBe('draw');
  });

  it('FINISH_DRAW dedupes consecutive duplicate vertices and enters confirmStrip', () => {
    const s = run([
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 5, y: 5 }, shift: false },
      { type: 'PLACE_VERTEX', point: { x: 20, y: 5 }, shift: false },
      { type: 'PLACE_VERTEX', point: { x: 20, y: 5 }, shift: false },
      { type: 'FINISH_DRAW' }
    ]);
    expect(s.mode).toEqual({ name: 'confirmStrip', vertices: [{ x: 5, y: 5 }, { x: 20, y: 5 }] });
  });

  it('STRIP_SAVED and CANCEL both return to idle', () => {
    const confirm = run([
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 0, y: 0 }, shift: false },
      { type: 'PLACE_VERTEX', point: { x: 9, y: 0 }, shift: false },
      { type: 'FINISH_DRAW' }
    ]);
    expect(layoutReducer(confirm, { type: 'STRIP_SAVED' }).mode).toEqual({ name: 'idle' });
    expect(layoutReducer(confirm, { type: 'CANCEL' }).mode).toEqual({ name: 'idle' });
  });

  it('CANCEL from draw preserves the existing selection', () => {
    const withSel: LayoutState = { ...initialLayoutState, selection: ['s1'] };
    const s = run([{ type: 'START_DRAW' }, { type: 'CANCEL' }], withSel);
    expect(s.selection).toEqual(['s1']);
    expect(s.mode).toEqual({ name: 'idle' });
  });
});

describe('selection and drags', () => {
  it('pointer-down on an unselected strip selects only it and starts dragStrip', () => {
    const s = run([{ type: 'STRIP_POINTER_DOWN', stripId: 's1', point: { x: 1, y: 1 }, shift: false }]);
    expect(s.selection).toEqual(['s1']);
    expect(s.mode).toEqual({ name: 'dragStrip', stripId: 's1', last: { x: 1, y: 1 }, moved: false });
  });

  it('pointer-down on an already-selected strip keeps the multi-selection', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1', 's2'] };
    const s = run([{ type: 'STRIP_POINTER_DOWN', stripId: 's2', point: { x: 1, y: 1 }, shift: false }], from);
    expect(s.selection).toEqual(['s1', 's2']);
    expect(s.mode.name).toBe('dragStrip');
  });

  it('shift+pointer-down toggles membership and does not start a drag', () => {
    const s1 = run([{ type: 'STRIP_POINTER_DOWN', stripId: 's1', point: { x: 0, y: 0 }, shift: true }]);
    expect(s1.selection).toEqual(['s1']);
    expect(s1.mode).toEqual({ name: 'idle' });
    const s2 = layoutReducer(s1, { type: 'STRIP_POINTER_DOWN', stripId: 's1', point: { x: 0, y: 0 }, shift: true });
    expect(s2.selection).toEqual([]);
  });

  it('VERTEX_POINTER_DOWN enters dragVertex', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1'] };
    const s = run([{ type: 'VERTEX_POINTER_DOWN', stripId: 's1', vertexIndex: 1 }], from);
    expect(s.mode).toEqual({ name: 'dragVertex', stripId: 's1', vertexIndex: 1, moved: false });
  });

  it('POINTER_MOVE marks drags as moved and tracks the last point', () => {
    const from = run([{ type: 'STRIP_POINTER_DOWN', stripId: 's1', point: { x: 1, y: 1 }, shift: false }]);
    const s = layoutReducer(from, { type: 'POINTER_MOVE', world: { x: 4, y: 6 }, screen: { x: 4, y: 6 } });
    expect(s.mode).toEqual({ name: 'dragStrip', stripId: 's1', last: { x: 4, y: 6 }, moved: true });
  });

  it('POINTER_UP ends dragStrip/dragVertex back to idle keeping selection', () => {
    const from = run([
      { type: 'STRIP_POINTER_DOWN', stripId: 's1', point: { x: 1, y: 1 }, shift: false },
      { type: 'POINTER_UP' }
    ]);
    expect(from.mode).toEqual({ name: 'idle' });
    expect(from.selection).toEqual(['s1']);
  });

  it('CLEAR_SELECTION empties the selection', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1', 's2'] };
    expect(layoutReducer(from, { type: 'CLEAR_SELECTION' }).selection).toEqual([]);
  });

  it('SELECTION_DELETED empties selection and returns to idle', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1'] };
    const s = layoutReducer(from, { type: 'SELECTION_DELETED' });
    expect(s).toEqual({ ...initialLayoutState, selection: [] });
  });
});

describe('pan and marquee on empty canvas', () => {
  it('BG_POINTER_DOWN without shift starts a pan', () => {
    const s = run([{ type: 'BG_POINTER_DOWN', world: { x: 5, y: 5 }, screen: { x: 50, y: 50 }, shift: false }]);
    expect(s.mode).toEqual({ name: 'pan', lastScreen: { x: 50, y: 50 }, moved: false });
  });

  it('a pan that never moved clears the selection on POINTER_UP (plain click on empty)', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1'] };
    const s = run([
      { type: 'BG_POINTER_DOWN', world: { x: 5, y: 5 }, screen: { x: 50, y: 50 }, shift: false },
      { type: 'POINTER_UP' }
    ], from);
    expect(s.selection).toEqual([]);
    expect(s.mode).toEqual({ name: 'idle' });
  });

  it('a pan that moved preserves the selection', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1'] };
    const s = run([
      { type: 'BG_POINTER_DOWN', world: { x: 5, y: 5 }, screen: { x: 50, y: 50 }, shift: false },
      { type: 'POINTER_MOVE', world: { x: 6, y: 6 }, screen: { x: 60, y: 60 } },
      { type: 'POINTER_UP' }
    ], from);
    expect(s.selection).toEqual(['s1']);
  });

  it('BG_POINTER_DOWN with shift starts a marquee at the world point', () => {
    const s = run([{ type: 'BG_POINTER_DOWN', world: { x: 5, y: 5 }, screen: { x: 5, y: 5 }, shift: true }]);
    expect(s.mode).toEqual({ name: 'marquee', origin: { x: 5, y: 5 }, current: { x: 5, y: 5 } });
  });

  it('POINTER_MOVE updates the marquee corner; POINTER_UP unions hits into selection', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1'] };
    const s = run([
      { type: 'BG_POINTER_DOWN', world: { x: 5, y: 5 }, screen: { x: 5, y: 5 }, shift: true },
      { type: 'POINTER_MOVE', world: { x: 95, y: 95 }, screen: { x: 95, y: 95 } },
      { type: 'POINTER_UP', marqueeHits: ['s1', 's2'] }
    ], from);
    expect(s.selection).toEqual(['s1', 's2']);   // no duplicate s1
    expect(s.mode).toEqual({ name: 'idle' });
  });

  it('TOGGLE_GRID_SNAP flips the flag', () => {
    expect(run([{ type: 'TOGGLE_GRID_SNAP' }]).gridSnap).toBe(true);
    expect(run([{ type: 'TOGGLE_GRID_SNAP' }, { type: 'TOGGLE_GRID_SNAP' }]).gridSnap).toBe(false);
  });
});
