import type { Point } from './geometry';

export type LayoutMode =
  | { name: 'idle' }
  | { name: 'draw'; vertices: Point[] }
  | { name: 'confirmStrip'; vertices: Point[] }
  | { name: 'pan'; lastScreen: Point; moved: boolean }
  | { name: 'marquee'; origin: Point; current: Point }
  | { name: 'dragStrip'; stripId: string; last: Point; moved: boolean }
  | { name: 'dragVertex'; stripId: string; vertexIndex: number; moved: boolean };

export interface LayoutState {
  mode: LayoutMode;
  selection: string[];
}

export const initialLayoutState: LayoutState = {
  mode: { name: 'idle' },
  selection: []
};

export type LayoutEvent =
  | { type: 'START_DRAW' }
  | { type: 'PLACE_VERTEX'; point: Point; shift: boolean }
  | { type: 'UNDO_VERTEX' }
  | { type: 'FINISH_DRAW' }
  | { type: 'STRIP_SAVED' }
  | { type: 'CANCEL' }
  | { type: 'STRIP_POINTER_DOWN'; stripId: string; point: Point; shift: boolean }
  | { type: 'VERTEX_POINTER_DOWN'; stripId: string; vertexIndex: number }
  | { type: 'BG_POINTER_DOWN'; world: Point; screen: Point; shift: boolean }
  | { type: 'POINTER_MOVE'; world: Point; screen: Point }
  | { type: 'POINTER_UP'; marqueeHits?: string[] }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SELECTION_DELETED' };

const DUPLICATE_EPS = 0.001;

export function layoutReducer(state: LayoutState, event: LayoutEvent): LayoutState {
  switch (event.type) {
    case 'START_DRAW':
      return state.mode.name === 'idle' ? { ...state, mode: { name: 'draw', vertices: [] } } : state;

    case 'PLACE_VERTEX': {
      // event.point already has angle- and grid-snapping applied by the
      // caller (LayoutSection's applyDrawSnap, which also knows the current
      // canvas size/viewport needed to compute the correct grid step) — this
      // used to redo both here too, harmlessly (idempotent on an
      // already-snapped point) but redundantly, and with a hardcoded
      // grid step that didn't match what applyDrawSnap actually used.
      if (state.mode.name !== 'draw') return state;
      return { ...state, mode: { name: 'draw', vertices: [...state.mode.vertices, event.point] } };
    }

    case 'UNDO_VERTEX':
      if (state.mode.name !== 'draw') return state;
      return { ...state, mode: { name: 'draw', vertices: state.mode.vertices.slice(0, -1) } };

    case 'FINISH_DRAW': {
      if (state.mode.name !== 'draw') return state;
      const deduped = state.mode.vertices.filter(
        (p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > DUPLICATE_EPS
      );
      if (deduped.length < 2) return { ...state, mode: { name: 'draw', vertices: deduped } };
      return { ...state, mode: { name: 'confirmStrip', vertices: deduped } };
    }

    case 'STRIP_SAVED':
      return state.mode.name === 'confirmStrip' ? { ...state, mode: { name: 'idle' } } : state;

    case 'CANCEL':
      return { ...state, mode: { name: 'idle' } };

    case 'STRIP_POINTER_DOWN': {
      if (state.mode.name !== 'idle') return state;
      if (event.shift) {
        const selection = state.selection.includes(event.stripId)
          ? state.selection.filter((id) => id !== event.stripId)
          : [...state.selection, event.stripId];
        return { ...state, selection };
      }
      const selection = state.selection.includes(event.stripId) ? state.selection : [event.stripId];
      return {
        ...state,
        selection,
        mode: { name: 'dragStrip', stripId: event.stripId, last: event.point, moved: false }
      };
    }

    case 'VERTEX_POINTER_DOWN':
      if (state.mode.name !== 'idle') return state;
      return {
        ...state,
        mode: { name: 'dragVertex', stripId: event.stripId, vertexIndex: event.vertexIndex, moved: false }
      };

    case 'BG_POINTER_DOWN':
      if (state.mode.name !== 'idle') return state;
      return event.shift
        ? { ...state, mode: { name: 'marquee', origin: event.world, current: event.world } }
        : { ...state, mode: { name: 'pan', lastScreen: event.screen, moved: false } };

    case 'POINTER_MOVE':
      switch (state.mode.name) {
        case 'pan':
          return { ...state, mode: { name: 'pan', lastScreen: event.screen, moved: true } };
        case 'marquee':
          return { ...state, mode: { ...state.mode, current: event.world } };
        case 'dragStrip':
          return { ...state, mode: { ...state.mode, last: event.world, moved: true } };
        case 'dragVertex':
          return { ...state, mode: { ...state.mode, moved: true } };
        default:
          return state;
      }

    case 'POINTER_UP':
      switch (state.mode.name) {
        case 'pan':
          return { ...state, mode: { name: 'idle' }, selection: state.mode.moved ? state.selection : [] };
        case 'marquee': {
          const hits = event.marqueeHits ?? [];
          const selection = [...state.selection, ...hits.filter((id) => !state.selection.includes(id))];
          return { ...state, mode: { name: 'idle' }, selection };
        }
        case 'dragStrip':
        case 'dragVertex':
          return { ...state, mode: { name: 'idle' } };
        default:
          return state;
      }

    case 'CLEAR_SELECTION':
      return { ...state, selection: [] };

    case 'SELECTION_DELETED':
      return { ...state, mode: { name: 'idle' }, selection: [] };

    default:
      return state;
  }
}
