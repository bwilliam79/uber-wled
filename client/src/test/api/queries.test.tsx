import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useControllers, useControllerStatuses, useCapabilities, useDevicePresets
} from '../../api/queries';

const CONTROLLERS = [
  { id: 'c1', name: 'Cabinet', host: '192.168.1.86', source: 'manual', stale: false, pinnedAssetPattern: null },
  { id: 'c2', name: 'Porch', host: '192.168.1.87', source: 'manual', stale: false, pinnedAssetPattern: null }
];

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function stubFetch(routes: Record<string, { ok: boolean; body: unknown }>) {
  const fn = vi.fn(async (url: string) => {
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return { ok: route.ok, json: async () => route.body };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('api/queries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('useControllers fetches /api/controllers under key [controllers]', async () => {
    stubFetch({ '/api/controllers': { ok: true, body: CONTROLLERS } });
    const { result } = renderHook(() => useControllers(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(CONTROLLERS));
  });

  it('useControllerStatuses returns a Map with a reachable:false fallback for failed status fetches', async () => {
    stubFetch({
      '/api/controllers': { ok: true, body: CONTROLLERS },
      '/api/controllers/c1/status': {
        ok: true,
        body: { controllerId: 'c1', reachable: true, info: null, state: null, polledAt: '2026-07-04T00:00:00Z' }
      },
      '/api/controllers/c2/status': { ok: false, body: {} }
    });
    const { result } = renderHook(() => useControllerStatuses(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.get('c1')!.reachable).toBe(true);
    expect(result.current.data!.get('c2')).toEqual({
      controllerId: 'c2', reachable: false, info: null, state: null, polledAt: null
    });
  });

  it('useCapabilities is disabled for null and fetches for an id', async () => {
    const caps = { vid: 1, effects: ['Solid'], palettes: ['Default'], fxMeta: [], palettePreviews: {}, fetchedAt: 'x' };
    const fetchMock = stubFetch({ '/api/controllers/c1/capabilities': { ok: true, body: caps } });
    const wrapper = makeWrapper();
    const disabled = renderHook(() => useCapabilities(null), { wrapper });
    expect(disabled.result.current.fetchStatus).toBe('idle');
    const enabled = renderHook(() => useCapabilities('c1'), { wrapper });
    await waitFor(() => expect(enabled.result.current.data).toEqual(caps));
    expect(fetchMock).toHaveBeenCalledWith('/api/controllers/c1/capabilities');
  });

  it('useDevicePresets fetches and unwraps presets for an id, stays idle for null', async () => {
    const presets = [{ id: 1, name: 'Night', isPlaylist: false }];
    stubFetch({ '/api/controllers/c1/presets': { ok: true, body: { presets } } });
    const wrapper = makeWrapper();
    const idle = renderHook(() => useDevicePresets(null), { wrapper });
    expect(idle.result.current.fetchStatus).toBe('idle');
    const active = renderHook(() => useDevicePresets('c1'), { wrapper });
    await waitFor(() => expect(active.result.current.data).toEqual(presets));
  });
});
