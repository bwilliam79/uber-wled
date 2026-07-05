import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Controller, RoomLabel, Strip } from '../../../api/client';

const { liveMap } = vi.hoisted(() => ({ liveMap: new Map() }));

vi.mock('../../../api/live', () => ({
  useLiveStatus: () => liveMap
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
  { id: 'c2', name: 'Deck Ctrl', host: '192.168.1.87', source: 'manual', stale: false, pinnedAssetPattern: null }
];

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

const fetchMock = vi.fn();
let rectSpy: Mock;

function mockCanvasRect(size: number) {
  (Element.prototype.getBoundingClientRect as unknown as Mock).mockReturnValue({
    left: 0, top: 0, width: size, height: size, right: size, bottom: size, x: 0, y: 0, toJSON: () => ({})
  } as DOMRect);
}

beforeEach(() => {
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
    if (url === '/api/controllers' && method === 'GET') return jsonResponse(controllers);
    throw new Error(`unmocked fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  // jsdom returns an all-zero rect; 100x100 makes screen coords == world coords
  // under the identity viewport.
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect') as unknown as Mock;
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
      <LayoutSection />
    </QueryClientProvider>
  );
}

async function selectStripByPointer(id: string, clientX: number, clientY: number) {
  fireEvent.pointerDown(screen.getByTestId(`strip-hit-${id}`), { clientX, clientY });
  fireEvent.pointerUp(screen.getByTestId('layout-canvas'), { clientX, clientY });
  await screen.findByTestId('selection-bar');
}

describe('draw flow', () => {
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
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({
        points: [{ x: 15, y: 30 }, { x: 45, y: 30 }]
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
