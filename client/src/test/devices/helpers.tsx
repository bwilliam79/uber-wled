import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
}

export function renderDevices(ui: ReactElement, client: QueryClient = makeQueryClient()) {
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  return { client, ...render(ui, { wrapper: Providers }) };
}

/**
 * Stub the global fetch with an exact-match `"METHOD url"` route table.
 * Unknown requests reject loudly so a test can never silently hit the
 * network (vitest-testing-gotchas: stub fetch globally, never nock).
 */
export function stubFetchRoutes(routes: Record<string, unknown>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    if (!(key in routes)) throw new Error(`unexpected fetch: ${key}`);
    return {
      ok: true,
      status: 200,
      json: async () => structuredClone(routes[key])
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
