import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useStrips, useRoomLabels } from '../../api/queries';

const strips = [{ id: 's1', controllerId: 'c1', wledSegId: 0, points: [{ x: 1, y: 2 }], label: null }];
const labels = [{ id: 'l1', name: 'Kitchen', x: 50, y: 20 }];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/strips') return { ok: true, status: 200, json: async () => strips };
    if (url === '/api/room-labels') return { ok: true, status: 200, json: async () => labels };
    throw new Error(`unmocked fetch: ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('layout data hooks', () => {
  it('useStrips fetches /api/strips under the ["strips"] key', async () => {
    const { result } = renderHook(() => useStrips(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(strips));
  });

  it('useRoomLabels fetches /api/room-labels', async () => {
    const { result } = renderHook(() => useRoomLabels(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(labels));
  });
});
