import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Controller, RoomLabel, Strip } from '../../../api/client';
import { ToastProvider } from '../../../components/ui/Toast';

const { liveMap } = vi.hoisted(() => ({ liveMap: new Map() }));

vi.mock('../../../api/live', () => ({
  // Filters by the requested ids, like the real hook (which subscribes only
  // to what it's given via /api/live?controllers=...) — a mock that ignored
  // this argument couldn't have caught the bug where a controller with no
  // strip yet was silently excluded from the ids passed to useLiveStatus.
  useLiveStatus: (ids: string[]) => new Map([...liveMap].filter(([id]) => ids.includes(id)))
}));

vi.mock('../../../control/ControlSurface', () => ({
  ControlSurface: ({ targets, open }: { targets: unknown[]; open: boolean; onClose(): void }) =>
    open ? <div data-testid="control-surface">{JSON.stringify(targets)}</div> : null
}));

import { LayoutSection } from '../../../sections/layout/LayoutSection';

const strips: Strip[] = [
  { id: 's1', controllerId: 'c1', wledSegId: 0, points: [{ x: 10, y: 10 }, { x: 40, y: 10 }], label: 'Porch' },
  { id: 's2', controllerId: 'c2', wledSegId: 3, points: [{ x: 60, y: 60 }, { x: 90, y: 60 }], label: null }
];
const labels: RoomLabel[] = [{ id: 'l1', name: 'Kitchen', x: 50, y: 20 }];
const controllers: Controller[] = [
  { id: 'c1', name: 'Porch Ctrl', host: '192.168.1.86', source: 'manual', stale: false, pinnedAssetPattern: null },
  { id: 'c2', name: 'Deck Ctrl', host: '192.168.1.87', source: 'manual', stale: false, pinnedAssetPattern: null },
  // No strip references c3 — covers a controller that hasn't had a strip
  // drawn for it yet, which is exactly the case the real app was in when
  // this bug was reported (zero strips existed anywhere).
  { id: 'c3', name: 'wled-bar-lights', host: '192.168.1.132', source: 'manual', stale: false, pinnedAssetPattern: null }
];

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

const fetchMock = vi.fn();

function mockCanvasRect(size: number) {
  (Element.prototype.getBoundingClientRect as unknown as Mock).mockReturnValue({
    left: 0, top: 0, width: size, height: size, right: size, bottom: size, x: 0, y: 0, toJSON: () => ({})
  } as DOMRect);
  // useElementSize (feeds computeGridStep, which the grid-snap tests below
  // depend on) reads clientWidth/clientHeight, not getBoundingClientRect —
  // these must stay consistent or the canvas size it sees won't match the
  // coordinate mapping above.
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(size);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(size);
}

beforeEach(() => {
  liveMap.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/strips' && method === 'GET') return jsonResponse(strips);
    if (url === '/api/strips' && method === 'POST') {
      const body = JSON.parse(String(init?.body));
      return jsonResponse({ strip: { id: 's-new', label: null, ...body }, recommendations: [] }, 201);
    }
    if (url.startsWith('/api/strips/') && method === 'PATCH') {
      const id = url.split('/').pop() as string;
      const body = JSON.parse(String(init?.body));
      return jsonResponse({ ...(strips.find((s) => s.id === id) as Strip), ...body });
    }
    if (url.startsWith('/api/strips/') && method === 'DELETE') return jsonResponse(null, 204);
    if (url === '/api/room-labels' && method === 'GET') return jsonResponse(labels);
    if (url.startsWith('/api/room-labels/') && method === 'PATCH') {
      const id = url.split('/').pop() as string;
      const body = JSON.parse(String(init?.body));
      return jsonResponse({ ...(labels.find((l) => l.id === id) as RoomLabel), ...body });
    }
    if (url.startsWith('/api/room-labels/') && method === 'DELETE') return jsonResponse(null, 204);
    if (url === '/api/controllers' && method === 'GET') return jsonResponse(controllers);
    throw new Error(`unmocked fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  // jsdom returns an all-zero rect; 100x100 makes screen coords == world coords
  // under the identity viewport.
  vi.spyOn(Element.prototype, 'getBoundingClientRect');
  mockCanvasRect(100);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <LayoutSection />
      </ToastProvider>
    </QueryClientProvider>
  );
}

async function selectStripByPointer(id: string, clientX: number, clientY: number) {
  fireEvent.pointerDown(screen.getByTestId(`strip-hit-${id}`), { clientX, clientY });
  fireEvent.pointerUp(screen.getByTestId('layout-canvas'), { clientX, clientY });
  await screen.findByTestId('selection-bar');
}

describe('draw flow', () => {
  it('the strip-save controller dropdown prefers the live device-reported name over the stored controller name', async () => {
    liveMap.set('c2', {
      reachable: true,
      state: { on: true, bri: 128, seg: [] },
      info: { name: 'Bar Lights', ver: '16.0.0', leds: { count: 48 }, arch: 'esp32' }
    });
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    fireEvent.keyDown(window, { key: 'Enter' });
    await screen.findByTestId('strip-save-panel');
    expect(screen.getByRole('option', { name: 'Bar Lights' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Deck Ctrl' })).toBeNull();
  });

  it('shows the live name even for a controller with zero strips so far', async () => {
    // Regression: controllerIds (and so the live-status subscription) was
    // derived only from strips.map(s => s.controllerId) — a controller with
    // no strip yet (c3, matching the real app's state when this was
    // reported: zero strips existed anywhere) was silently excluded, so its
    // live name never arrived and the dropdown fell back to the stale
    // stored name no matter what.
    liveMap.set('c3', {
      reachable: true,
      state: { on: true, bri: 128, seg: [] },
      info: { name: 'Bar Lights', ver: '16.0.0', leds: { count: 48 }, arch: 'esp32' }
    });
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    fireEvent.keyDown(window, { key: 'Enter' });
    await screen.findByTestId('strip-save-panel');
    expect(screen.getByRole('option', { name: 'Bar Lights' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'wled-bar-lights' })).toBeNull();
  });

  it('places vertices with clicks, finishes with Enter, and POSTs the strip', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    fireEvent.click(canvas, { clientX: 50, clientY: 50 });
    fireEvent.keyDown(window, { key: 'Enter' });
    await screen.findByTestId('strip-save-panel');
    fireEvent.change(screen.getByLabelText('Controller'), { target: { value: 'c2' } });
    fireEvent.change(screen.getByLabelText('Segment ID'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Label (optional)'), { target: { value: 'Desk run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save strip' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u, i]) => u === '/api/strips' && (i as RequestInit)?.method === 'POST');
      expect(post).toBeDefined();
      expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({
        controllerId: 'c2',
        wledSegId: 3,
        points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }],
        label: 'Desk run'
      });
    });
    expect(screen.queryByTestId('strip-save-panel')).toBeNull();
  });

  it('Backspace undoes the last vertex; Escape cancels drawing', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    fireEvent.click(canvas, { clientX: 90, clientY: 10 });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(screen.getByTestId('draw-line').getAttribute('points')).toBe('10,10 50,10');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('draw-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'Draw strip' })).toBeDefined();
    expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/strips' && (i as RequestInit)?.method === 'POST')).toBe(false);
  });

  it('the Finish line button is disabled below 2 points and dispatches FINISH_DRAW once enabled', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    const finishBtn = screen.getByRole('button', { name: 'Finish line' }) as HTMLButtonElement;
    expect(finishBtn.disabled).toBe(true);
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    expect(finishBtn.disabled).toBe(true);
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    expect(finishBtn.disabled).toBe(false);
    fireEvent.click(finishBtn);
    await screen.findByTestId('strip-save-panel');
  });

  it('Cancel in the draw action bar discards the in-progress line', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('draw-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'Draw strip' })).toBeDefined();
  });

  it('shift constrains a placed vertex to the nearest 45-degree angle from the previous one', async () => {
    // End-to-end coverage for angle-snap now that it's applied entirely by
    // the caller (applyDrawSnap) rather than re-applied inside the reducer.
    // (10,10) -> raw click (34,17): dx=24, dy=7, a 7-24-25 right triangle, so
    // distance is a clean 25; the angle (~16.3 deg) snaps to horizontal (0),
    // giving (35,10) — then the always-on grid snap rounds 35 to the nearest
    // 2-unit grid point, 36.
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 34, clientY: 17, shiftKey: true });
    expect(screen.getByTestId('draw-line').getAttribute('points')).toBe('10,10 36,10');
  });

  it('snaps to the coarsened grid step at a realistic canvas size, not the raw GRID_SIZE', async () => {
    // Regression test for the REAL bug: a 100x100 test canvas (used by every
    // other test in this file) never needs step-coarsening (100/2 = 50 lines,
    // under the 150 cap), so it never exercised this at all — every previous
    // test kept passing while the actual browser (canvases hundreds of px
    // wide) coarsened the *visible* grid to e.g. every 16 units while still
    // snapping placed points to the raw 2-unit grid, which never lands on a
    // visible intersection. At 1552px wide, the step coarsens to 16 (see
    // computeGridStep). Click at (100,105): nearest multiples of 16 are
    // 96 and 112.
    mockCanvasRect(1552);
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.click(canvas, { clientX: 100, clientY: 105 });
    expect(screen.getByTestId('draw-line').getAttribute('points')).toBe('96,112');
  });

  it('snap to grid actually snaps placed vertices, not just the preview cursor', async () => {
    // Regression test: the toggle correctly enabled the visual grid and the
    // rubber-band preview snapped, but handleCanvasClick placed the raw
    // unsnapped point — so the vertex that actually landed on click ignored
    // "Snap to grid" entirely. GRID_SIZE is 2 world units.
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.click(canvas, { clientX: 11, clientY: 13 });
    fireEvent.click(canvas, { clientX: 47, clientY: 9 });
    fireEvent.click(screen.getByRole('button', { name: 'Finish line' }));
    await screen.findByTestId('strip-save-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Save strip' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u, i]) => u === '/api/strips' && (i as RequestInit)?.method === 'POST');
      expect(JSON.parse(String((post![1] as RequestInit).body)).points).toEqual([{ x: 12, y: 14 }, { x: 48, y: 10 }]);
    });
  });

  it('double-click finishes the path without keeping the duplicate vertex', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    // the second click of a dblclick lands as an extra PLACE_VERTEX first
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    fireEvent.doubleClick(canvas, { clientX: 50, clientY: 10 });
    await screen.findByTestId('strip-save-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Save strip' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u, i]) => u === '/api/strips' && (i as RequestInit)?.method === 'POST');
      expect(JSON.parse(String((post![1] as RequestInit).body)).points).toEqual([{ x: 10, y: 10 }, { x: 50, y: 10 }]);
    });
  });
});

describe('selection', () => {
  it('shift+drag marquee selects intersecting strips and Control opens the surface with segment targets', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.pointerDown(screen.getByTestId('canvas-bg'), { clientX: 5, clientY: 5, shiftKey: true });
    fireEvent.pointerMove(canvas, { clientX: 95, clientY: 95 });
    fireEvent.pointerUp(canvas, { clientX: 95, clientY: 95 });
    const bar = await screen.findByTestId('selection-bar');
    expect(bar.textContent).toContain('2 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    const surface = screen.getByTestId('control-surface');
    expect(JSON.parse(surface.textContent as string)).toEqual([
      { kind: 'segment', controllerId: 'c1', wledSegId: 0 },
      { kind: 'segment', controllerId: 'c2', wledSegId: 3 }
    ]);
  });

  it('shift-click adds a second strip to the selection', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    fireEvent.pointerDown(screen.getByTestId('strip-hit-s2'), { clientX: 70, clientY: 60, shiftKey: true });
    fireEvent.pointerUp(screen.getByTestId('layout-canvas'));
    expect((await screen.findByTestId('selection-bar')).textContent).toContain('2 selected');
  });

  it('a plain click on empty canvas clears the selection', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    fireEvent.pointerDown(screen.getByTestId('canvas-bg'), { clientX: 80, clientY: 30 });
    fireEvent.pointerUp(screen.getByTestId('layout-canvas'), { clientX: 80, clientY: 30 });
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).toBeNull());
  });
});

describe('editing', () => {
  it('dragging a selected strip persists translated points via PATCH', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.pointerDown(screen.getByTestId('strip-hit-s1'), { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 25, clientY: 30 });
    fireEvent.pointerUp(canvas, { clientX: 25, clientY: 30 });
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([u, i]) => u === '/api/strips/s1' && (i as RequestInit)?.method === 'PATCH');
      expect(patch).toBeDefined();
      // Snap is always on: the raw drag lands the anchor at (15,30), which
      // snaps to the nearest 2-unit grid point (16,30); that +1,0 correction
      // applies to every point without distorting the strip.
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({
        points: [{ x: 16, y: 30 }, { x: 46, y: 30 }]
      });
    });
  });

  it('dragging a whole strip with snap to grid on snaps by a single reference point, without distorting the shape', async () => {
    // Regression test: dragStrip had no grid-snap handling at all — a
    // dragged strip landed at whatever raw pixel offset the pointer stopped
    // at, "Snap to grid" or not. Snapping every vertex independently would
    // distort the strip's shape, so this snaps by the first vertex only and
    // applies that same correction to every point (GRID_SIZE is 2).
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.pointerDown(screen.getByTestId('strip-hit-s1'), { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 23, clientY: 31 }); // dx=3, dy=21 -> raw (13,31)/(43,31)
    fireEvent.pointerUp(canvas, { clientX: 23, clientY: 31 });
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([u, i]) => u === '/api/strips/s1' && (i as RequestInit)?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({
        points: [{ x: 14, y: 32 }, { x: 44, y: 32 }]
      });
    });
  });

  it('dragging a vertex handle moves only that vertex', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.pointerDown(screen.getByTestId('vertex-s1-0'), { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 12, clientY: 44 });
    fireEvent.pointerUp(canvas, { clientX: 12, clientY: 44 });
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([u, i]) => u === '/api/strips/s1' && (i as RequestInit)?.method === 'PATCH');
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({
        points: [{ x: 12, y: 44 }, { x: 40, y: 10 }]
      });
    });
  });

  it('Delete removes the selected strip after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/strips/s1' && (i as RequestInit)?.method === 'DELETE')).toBe(true);
    });
    await waitFor(() => expect(screen.queryByTestId('strip-s1')).toBeNull());
  });

  it('declining the confirm leaves the strip alone', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit)?.method === 'DELETE')).toBe(false);
  });

  it('clicking a room label reveals its delete button, which DELETEs it and removes it from the canvas', async () => {
    renderSection();
    await screen.findByTestId('room-label-l1');
    fireEvent.pointerDown(screen.getByTestId('room-label-l1'), { clientX: 50, clientY: 20 });
    fireEvent.pointerUp(screen.getByTestId('room-label-l1'));
    const deleteBtn = screen.getByTestId('room-label-delete-l1');
    fireEvent.click(deleteBtn);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([u, i]) => u === '/api/room-labels/l1' && (i as RequestInit)?.method === 'DELETE')
      ).toBe(true);
    });
    await waitFor(() => expect(screen.queryByTestId('room-label-l1')).toBeNull());
  });

  it('Backspace deletes the selected room label', async () => {
    renderSection();
    await screen.findByTestId('room-label-l1');
    fireEvent.pointerDown(screen.getByTestId('room-label-l1'), { clientX: 50, clientY: 20 });
    fireEvent.pointerUp(screen.getByTestId('room-label-l1'));
    fireEvent.keyDown(window, { key: 'Backspace' });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([u, i]) => u === '/api/room-labels/l1' && (i as RequestInit)?.method === 'DELETE')
      ).toBe(true);
    });
    await waitFor(() => expect(screen.queryByTestId('room-label-l1')).toBeNull());
  });

  it('toasts an error and keeps the label when the delete request fails', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/strips' && method === 'GET') return jsonResponse(strips);
      if (url === '/api/room-labels' && method === 'GET') return jsonResponse(labels);
      if (url === '/api/controllers' && method === 'GET') return jsonResponse(controllers);
      if (url.startsWith('/api/room-labels/') && method === 'DELETE') return jsonResponse({ error: 'nope' }, 500);
      throw new Error(`unmocked fetch: ${method} ${url}`);
    });
    renderSection();
    await screen.findByTestId('room-label-l1');
    fireEvent.pointerDown(screen.getByTestId('room-label-l1'), { clientX: 50, clientY: 20 });
    fireEvent.pointerUp(screen.getByTestId('room-label-l1'));
    fireEvent.click(screen.getByTestId('room-label-delete-l1'));
    await screen.findByText('Could not delete room label');
    expect(screen.getByTestId('room-label-l1')).toBeDefined();
  });

  it('renaming a room label inline PATCHes the name', async () => {
    renderSection();
    await screen.findByTestId('room-label-l1');
    fireEvent.doubleClick(screen.getByTestId('room-label-l1'));
    const input = screen.getByTestId('room-label-input-l1');
    fireEvent.change(input, { target: { value: 'Pantry' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([u, i]) => u === '/api/room-labels/l1' && (i as RequestInit)?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ name: 'Pantry' });
    });
  });
});

describe('navigation', () => {
  it('wheel zooms the world group about the cursor', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.wheel(screen.getByTestId('layout-canvas'), { clientX: 50, clientY: 50, deltaY: -400 });
    const transform = screen.getByTestId('world-group').getAttribute('transform') as string;
    const scale = Number((/scale\(([\d.]+)\)/.exec(transform) as RegExpExecArray)[1]);
    expect(scale).toBeGreaterThan(1);
  });

  it('Fit all fits the 0..100 world box into the container', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    mockCanvasRect(148);
    fireEvent.click(screen.getByRole('button', { name: 'Fit all' }));
    expect(screen.getByTestId('world-group').getAttribute('transform')).toBe('translate(24 24) scale(1)');
  });
});
