import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addRoomLabel, addStrip, deleteRoomLabel, deleteStrip, updateRoomLabel, updateStrip,
  type RoomLabel, type Strip, type Target
} from '../../api/client';
import { useControllers, useRoomLabels, useStrips } from '../../api/queries';
import { useLiveStatus } from '../../api/live';
import { ControlSurface } from '../../control/ControlSurface';
import { useToast } from '../../components/ui/Toast';
import {
  IDENTITY_VIEWPORT, fitAllViewport, normalizeRect, panBy, polylineIntersectsRect,
  screenToWorld, snapAngle, snapToGrid, zoomAt, type Point, type Viewport
} from './geometry';
import { initialLayoutState, layoutReducer } from './canvasMode';
import { LayoutCanvas } from './LayoutCanvas';
import './layout.css';

/** Fit-all always includes the legacy 0..100 world box so the "floor" stays framed. */
const WORLD_BOX_CORNERS: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 100 }];

export function LayoutSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const stripsQuery = useStrips();
  const labelsQuery = useRoomLabels();
  const controllersQuery = useControllers();

  const strips = useMemo(() => stripsQuery.data ?? [], [stripsQuery.data]);
  const labels = labelsQuery.data ?? [];
  const controllers = controllersQuery.data ?? [];

  const [state, dispatch] = useReducer(layoutReducer, initialLayoutState);
  const [viewport, setViewport] = useState<Viewport>(IDENTITY_VIEWPORT);
  const [drawCursor, setDrawCursor] = useState<Point | null>(null);
  const [dragOverride, setDragOverride] = useState<Map<string, Point[]>>(new Map());
  const [surfaceOpen, setSurfaceOpen] = useState(false);
  const [formControllerId, setFormControllerId] = useState('');
  const [formSegId, setFormSegId] = useState(0);
  const [formLabel, setFormLabel] = useState('');
  const [newLabelName, setNewLabelName] = useState('');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const touchPointsRef = useRef<Map<number, Point>>(new Map());

  const controllerIds = useMemo(
    () => Array.from(new Set(strips.map((s) => s.controllerId))).sort(),
    [strips]
  );
  const live = useLiveStatus(controllerIds);

  const renderStrips = useMemo(
    () => strips.map((s) => {
      const override = dragOverride.get(s.id);
      return override ? { ...s, points: override } : s;
    }),
    [strips, dragOverride]
  );

  const addStripMut = useMutation({
    mutationFn: (input: { controllerId: string; wledSegId: number; points: Point[]; label: string | null }) =>
      addStrip(input),
    onSuccess: ({ strip }) => {
      queryClient.setQueryData<Strip[]>(['strips'], (prev) => [...(prev ?? []), strip]);
      dispatch({ type: 'STRIP_SAVED' });
    }
  });

  const updateStripMut = useMutation({
    mutationFn: ({ id, points }: { id: string; points: Point[] }) => updateStrip(id, { points }),
    onSuccess: (saved) => {
      queryClient.setQueryData<Strip[]>(['strips'], (prev) =>
        (prev ?? []).map((s) => (s.id === saved.id ? saved : s))
      );
      setDragOverride((prev) => {
        const next = new Map(prev);
        next.delete(saved.id);
        return next;
      });
    }
  });

  const upsertLabel = (saved: RoomLabel) =>
    queryClient.setQueryData<RoomLabel[]>(['room-labels'], (prev) =>
      (prev ?? []).map((l) => (l.id === saved.id ? saved : l))
    );
  const moveLabelMut = useMutation({
    mutationFn: ({ id, x, y }: { id: string; x: number; y: number }) => updateRoomLabel(id, { x, y }),
    onSuccess: upsertLabel
  });
  const renameLabelMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateRoomLabel(id, { name }),
    onSuccess: upsertLabel
  });
  const addLabelMut = useMutation({
    mutationFn: (input: { name: string; x: number; y: number }) => addRoomLabel(input),
    onSuccess: (created) => {
      queryClient.setQueryData<RoomLabel[]>(['room-labels'], (prev) => [...(prev ?? []), created]);
      setNewLabelName('');
    }
  });
  const deleteLabelMut = useMutation({
    mutationFn: (id: string) => deleteRoomLabel(id),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<RoomLabel[]>(['room-labels'], (prev) => (prev ?? []).filter((l) => l.id !== id));
    },
    onError: () => {
      toast.show({ title: 'Could not delete room label', variant: 'error' });
    }
  });

  const toScreen = useCallback((clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => screenToWorld(viewport, toScreen(clientX, clientY)),
    [viewport, toScreen]
  );

  // Native wheel listener: React's root-delegated onWheel is passive, so
  // preventDefault (needed to stop page scroll) requires a manual listener.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setViewport((vp) => zoomAt(vp, pt, Math.exp(-e.deltaY * 0.0015)));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  async function handleDeleteSelected() {
    const ids = state.selection;
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} strip${ids.length === 1 ? '' : 's'} from the layout?`)) return;
    await Promise.all(ids.map((id) => deleteStrip(id)));
    queryClient.setQueryData<Strip[]>(['strips'], (prev) => (prev ?? []).filter((s) => !ids.includes(s.id)));
    dispatch({ type: 'SELECTION_DELETED' });
  }

  // Keyboard shortcuts. No dependency array on purpose: re-registering each
  // render keeps the handler's captured state fresh without a ref dance.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (state.mode.name === 'draw') {
        if (e.key === 'Enter') dispatch({ type: 'FINISH_DRAW' });
        if (e.key === 'Escape') handleCancelDraw();
        if (e.key === 'Backspace') { e.preventDefault(); dispatch({ type: 'UNDO_VERTEX' }); }
        return;
      }
      if (state.mode.name === 'confirmStrip' && e.key === 'Escape') { dispatch({ type: 'CANCEL' }); return; }
      if (state.mode.name === 'idle' && state.selection.length > 0 && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        void handleDeleteSelected();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function applyDrawSnap(p: Point, shift: boolean): Point {
    let out = p;
    if (state.mode.name === 'draw' && shift && state.mode.vertices.length > 0) {
      out = snapAngle(state.mode.vertices[state.mode.vertices.length - 1], out);
    }
    if (state.gridSnap) out = snapToGrid(out);
    return out;
  }

  function handleCanvasClick(e: React.MouseEvent) {
    if (state.mode.name !== 'draw') return;
    dispatch({ type: 'PLACE_VERTEX', point: toWorld(e.clientX, e.clientY), shift: e.shiftKey });
  }

  function handleCanvasDoubleClick() {
    if (state.mode.name !== 'draw') return;
    // dblclick already fired two click events; drop the duplicate vertex.
    dispatch({ type: 'UNDO_VERTEX' });
    dispatch({ type: 'FINISH_DRAW' });
  }

  function handleBackgroundPointerDown(e: React.PointerEvent) {
    if (e.pointerType === 'touch') {
      touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointsRef.current.size > 1) return; // second finger = pinch, not a gesture start
    }
    if (state.mode.name !== 'idle') return;
    dispatch({
      type: 'BG_POINTER_DOWN',
      world: toWorld(e.clientX, e.clientY),
      screen: toScreen(e.clientX, e.clientY),
      shift: e.shiftKey
    });
  }

  function handleStripPointerDown(stripId: string, e: React.PointerEvent) {
    e.stopPropagation();
    if (state.mode.name !== 'idle') return;
    dispatch({ type: 'STRIP_POINTER_DOWN', stripId, point: toWorld(e.clientX, e.clientY), shift: e.shiftKey });
  }

  function handleVertexPointerDown(stripId: string, vertexIndex: number, _e: React.PointerEvent) {
    if (state.mode.name !== 'idle') return;
    dispatch({ type: 'VERTEX_POINTER_DOWN', stripId, vertexIndex });
  }

  function handlePointerMove(e: React.PointerEvent) {
    // Two-finger pinch zoom (touch only).
    if (e.pointerType === 'touch' && touchPointsRef.current.has(e.pointerId)) {
      if (touchPointsRef.current.size === 2) {
        const prev = new Map(touchPointsRef.current);
        touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a1, b1] = Array.from(prev.values());
        const [a2, b2] = Array.from(touchPointsRef.current.values());
        const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
        const d2 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (d1 > 0 && d2 > 0) {
          const mid = toScreen((a2.x + b2.x) / 2, (a2.y + b2.y) / 2);
          setViewport((vp) => zoomAt(vp, mid, d2 / d1));
        }
        return;
      }
      touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    const world = toWorld(e.clientX, e.clientY);
    const screen = toScreen(e.clientX, e.clientY);

    if (state.mode.name === 'draw') {
      setDrawCursor(applyDrawSnap(world, e.shiftKey));
      return;
    }
    if (state.mode.name === 'pan') {
      const dx = screen.x - state.mode.lastScreen.x;
      const dy = screen.y - state.mode.lastScreen.y;
      setViewport((vp) => panBy(vp, dx, dy));
    }
    if (state.mode.name === 'dragStrip') {
      const dx = world.x - state.mode.last.x;
      const dy = world.y - state.mode.last.y;
      setDragOverride((prev) => {
        const next = new Map(prev);
        for (const id of state.selection) {
          const base = next.get(id) ?? strips.find((s) => s.id === id)?.points;
          if (base) next.set(id, base.map((p) => ({ x: p.x + dx, y: p.y + dy })));
        }
        return next;
      });
    }
    if (state.mode.name === 'dragVertex') {
      const { stripId, vertexIndex } = state.mode;
      const target = state.gridSnap ? snapToGrid(world) : world;
      setDragOverride((prev) => {
        const next = new Map(prev);
        const base = next.get(stripId) ?? strips.find((s) => s.id === stripId)?.points;
        if (base) next.set(stripId, base.map((p, i) => (i === vertexIndex ? target : p)));
        return next;
      });
    }
    dispatch({ type: 'POINTER_MOVE', world, screen });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (e.pointerType === 'touch') touchPointsRef.current.delete(e.pointerId);
    if (state.mode.name === 'marquee') {
      const rect = normalizeRect(state.mode.origin, state.mode.current);
      const hits = renderStrips.filter((s) => polylineIntersectsRect(s.points, rect)).map((s) => s.id);
      dispatch({ type: 'POINTER_UP', marqueeHits: hits });
      return;
    }
    if ((state.mode.name === 'dragStrip' || state.mode.name === 'dragVertex') && state.mode.moved) {
      for (const [id, points] of dragOverride) updateStripMut.mutate({ id, points });
    }
    dispatch({ type: 'POINTER_UP' });
  }

  function handleStartDraw() {
    setFormControllerId(controllers[0]?.id ?? '');
    setFormSegId(0);
    setFormLabel('');
    setDrawCursor(null);
    dispatch({ type: 'START_DRAW' });
  }

  function handleCancelDraw() {
    dispatch({ type: 'CANCEL' });
    setDrawCursor(null);
  }

  function handleSaveStrip() {
    if (state.mode.name !== 'confirmStrip' || !formControllerId) return;
    addStripMut.mutate({
      controllerId: formControllerId,
      wledSegId: formSegId,
      points: state.mode.vertices,
      label: formLabel.trim() || null
    });
  }

  function handleFitAll() {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const pts: Point[] = [
      ...WORLD_BOX_CORNERS,
      ...strips.flatMap((s) => s.points),
      ...labels.map((l) => ({ x: l.x, y: l.y }))
    ];
    setViewport(fitAllViewport(pts, rect.width, rect.height));
  }

  function handleAddLabel() {
    const name = newLabelName.trim();
    if (!name) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const center = rect && rect.width > 0
      ? screenToWorld(viewport, { x: rect.width / 2, y: rect.height / 2 })
      : { x: 50, y: 50 };
    addLabelMut.mutate({ name, x: center.x, y: center.y });
  }

  const targets: Target[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Target[] = [];
    for (const s of strips) {
      if (!state.selection.includes(s.id)) continue;
      const key = `${s.controllerId}:${s.wledSegId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: 'segment', controllerId: s.controllerId, wledSegId: s.wledSegId });
    }
    return out;
  }, [strips, state.selection]);

  const isDrawing = state.mode.name === 'draw';
  const drawVertexCount = state.mode.name === 'draw' ? state.mode.vertices.length : 0;
  const marqueeRect = state.mode.name === 'marquee' ? normalizeRect(state.mode.origin, state.mode.current) : null;

  return (
    <section className="layout-section">
      <div className="layout-toolbar">
        <h2>Layout</h2>
        <div className="layout-toolbar-actions">
          <label className="layout-snap-toggle">
            <input type="checkbox" checked={state.gridSnap} onChange={() => dispatch({ type: 'TOGGLE_GRID_SNAP' })} />
            Snap to grid
          </label>
          <button type="button" className="layout-btn" onClick={handleFitAll}>Fit all</button>
          <input
            aria-label="new room label"
            className="layout-input"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            placeholder="Room label"
          />
          <button type="button" className="layout-btn" onClick={handleAddLabel} disabled={!newLabelName.trim()}>
            Add label
          </button>
          {!isDrawing && state.mode.name !== 'confirmStrip' && (
            <button type="button" className="layout-btn primary" onClick={handleStartDraw} disabled={controllers.length === 0}>
              Draw strip
            </button>
          )}
          {isDrawing && (
            <div className="layout-draw-actions" data-testid="draw-actions">
              <button
                type="button"
                className="layout-btn primary"
                onClick={() => dispatch({ type: 'FINISH_DRAW' })}
                disabled={drawVertexCount < 2}
              >
                Finish line
              </button>
              <button type="button" className="layout-btn" onClick={handleCancelDraw}>
                Cancel
              </button>
              <span className="layout-draw-hint">
                Enter/double-click also finishes · Backspace undoes · Shift = 45°
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="layout-canvas-wrap">
        <LayoutCanvas
          strips={renderStrips}
          labels={labels}
          live={live}
          selection={state.selection}
          viewport={viewport}
          gridSnap={state.gridSnap}
          drawVertices={state.mode.name === 'draw' ? state.mode.vertices : null}
          drawCursor={state.mode.name === 'draw' ? drawCursor : null}
          marqueeRect={marqueeRect}
          svgRef={svgRef}
          toWorld={toWorld}
          onStripPointerDown={handleStripPointerDown}
          onVertexPointerDown={handleVertexPointerDown}
          onBackgroundPointerDown={handleBackgroundPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onCanvasClick={handleCanvasClick}
          onCanvasDoubleClick={handleCanvasDoubleClick}
          onMoveLabel={(id, x, y) => moveLabelMut.mutate({ id, x, y })}
          onRenameLabel={(id, name) => renameLabelMut.mutate({ id, name })}
          onDeleteLabel={(id) => deleteLabelMut.mutate(id)}
        />
        {strips.length === 0 && !isDrawing && (
          <p className="layout-hint">
            {controllers.length === 0
              ? 'Add a controller in Devices, then come back here to draw your first strip.'
              : 'Click "Draw strip" to trace your first LED strip onto the canvas.'}
          </p>
        )}
      </div>

      {state.mode.name === 'confirmStrip' && (
        <div className="layout-confirm-panel" data-testid="strip-save-panel">
          <h3>Save strip</h3>
          <div className="layout-field">
            <label htmlFor="strip-controller">Controller</label>
            <select
              id="strip-controller"
              className="layout-input"
              value={formControllerId}
              onChange={(e) => setFormControllerId(e.target.value)}
            >
              {controllers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="layout-field">
            <label htmlFor="strip-seg">Segment ID</label>
            <input
              id="strip-seg"
              className="layout-input"
              type="number"
              min={0}
              value={formSegId}
              onChange={(e) => setFormSegId(Number(e.target.value))}
            />
          </div>
          <div className="layout-field">
            <label htmlFor="strip-label">Label (optional)</label>
            <input
              id="strip-label"
              className="layout-input"
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder="Porch rail"
            />
          </div>
          <div className="layout-confirm-actions">
            <button
              type="button"
              className="layout-btn primary"
              onClick={handleSaveStrip}
              disabled={!formControllerId || addStripMut.isPending}
            >
              Save strip
            </button>
            <button type="button" className="layout-btn" onClick={() => dispatch({ type: 'CANCEL' })}>Cancel</button>
          </div>
        </div>
      )}

      {state.selection.length > 0 && state.mode.name === 'idle' && (
        <div className="layout-selection-bar" data-testid="selection-bar">
          <span>{state.selection.length} selected</span>
          <button type="button" className="layout-btn primary" onClick={() => setSurfaceOpen(true)}>Control</button>
          <button type="button" className="layout-btn danger" onClick={() => void handleDeleteSelected()}>Delete</button>
          <button type="button" className="layout-btn" onClick={() => dispatch({ type: 'CLEAR_SELECTION' })}>Clear</button>
        </div>
      )}

      <ControlSurface targets={targets} open={surfaceOpen} onClose={() => setSurfaceOpen(false)} />
    </section>
  );
}
