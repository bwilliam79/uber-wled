import type { ReactElement, ReactNode } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../../components/ui/Toast';
import { SyncSection } from '../../../sections/sync/SyncSection';

function renderSync(ui: ReactElement = <SyncSection />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  return render(ui, { wrapper: Providers });
}

const CONTROLLERS = [
  { id: 'c1', name: 'Cabinet', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null },
  { id: 'c2', name: 'Porch', host: '10.0.0.51', source: 'manual', stale: false, pinnedAssetPattern: null }
];

function stubFetchRoutes(routes: Record<string, unknown | ((init?: RequestInit) => unknown)>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    if (!(key in routes)) throw new Error(`unexpected fetch: ${key}`);
    const entry = routes[key];
    const body = typeof entry === 'function' ? (entry as (init?: RequestInit) => unknown)(init) : entry;
    return { ok: true, status: 200, json: async () => structuredClone(body) } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const EMPTY_GROUP = { id: 'g1', name: 'Front porch', active: false, bitmask: null, memberControllerIds: ['c1'] };

afterEach(() => vi.unstubAllGlobals());

describe('SyncSection', () => {
  it('shows the empty state with no sync groups', async () => {
    stubFetchRoutes({ 'GET /api/controllers': CONTROLLERS, 'GET /api/sync-groups': [] });
    renderSync();
    await waitFor(() => expect(screen.getByText('No sync groups yet.')).toBeTruthy());
  });

  it('lists a group with its members and Inactive chip', async () => {
    stubFetchRoutes({ 'GET /api/controllers': CONTROLLERS, 'GET /api/sync-groups': [EMPTY_GROUP] });
    renderSync();
    await waitFor(() => expect(screen.getByText('Front porch')).toBeTruthy());
    expect(screen.getByText('Cabinet')).toBeTruthy();
    expect(screen.getByText('Inactive')).toBeTruthy();
  });

  it('creates a sync group with the picked controllers', async () => {
    const fetchMock = stubFetchRoutes({
      'GET /api/controllers': CONTROLLERS,
      'GET /api/sync-groups': [],
      'POST /api/sync-groups': (init?: RequestInit) => {
        const body = JSON.parse(init!.body as string);
        return { id: 'g-new', name: body.name, active: false, bitmask: null, memberControllerIds: body.memberControllerIds };
      }
    });
    renderSync();
    await waitFor(() => expect(screen.getByText('No sync groups yet.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'New sync group' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Show lights' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Cabinet/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Porch/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create sync group' }));
    await waitFor(() => expect(screen.getByText('Show lights')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/sync-groups', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Show lights', memberControllerIds: ['c1', 'c2'] })
    }));
  });

  it('activates a group and shows it as Active', async () => {
    stubFetchRoutes({
      'GET /api/controllers': CONTROLLERS,
      'GET /api/sync-groups': [EMPTY_GROUP],
      'POST /api/sync-groups/g1/activate': {
        group: { ...EMPTY_GROUP, active: true, bitmask: 1 },
        results: [{ controllerId: 'c1', ok: true }]
      }
    });
    renderSync();
    await waitFor(() => expect(screen.getByText('Front porch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Activate Front porch' }));
    await waitFor(() => expect(screen.getByText('Active')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Deactivate Front porch' })).toBeTruthy();
  });

  it('surfaces per-controller failures in a toast without blocking the active state', async () => {
    stubFetchRoutes({
      'GET /api/controllers': CONTROLLERS,
      'GET /api/sync-groups': [EMPTY_GROUP],
      'POST /api/sync-groups/g1/activate': {
        group: { ...EMPTY_GROUP, active: true, bitmask: 1 },
        results: [{ controllerId: 'c1', ok: false, error: 'connect ECONNREFUSED' }]
      }
    });
    renderSync();
    await waitFor(() => expect(screen.getByText('Front porch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Activate Front porch' }));
    await waitFor(() => expect(screen.getByText('Active')).toBeTruthy());
    expect(screen.getByText(/1 controller failing/)).toBeTruthy();
    expect(screen.getByText('connect ECONNREFUSED')).toBeTruthy();
  });

  it('deactivates a group and shows it as Inactive again', async () => {
    const activeGroup = { ...EMPTY_GROUP, active: true, bitmask: 1 };
    stubFetchRoutes({
      'GET /api/controllers': CONTROLLERS,
      'GET /api/sync-groups': [activeGroup],
      'POST /api/sync-groups/g1/deactivate': {
        group: { ...EMPTY_GROUP, active: false, bitmask: null },
        results: [{ controllerId: 'c1', ok: true }]
      }
    });
    renderSync();
    await waitFor(() => expect(screen.getByText('Front porch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Front porch' }));
    await waitFor(() => expect(screen.getByText('Inactive')).toBeTruthy());
  });

  it('renames a group via the edit modal', async () => {
    const fetchMock = stubFetchRoutes({
      'GET /api/controllers': CONTROLLERS,
      'GET /api/sync-groups': [EMPTY_GROUP],
      'PATCH /api/sync-groups/g1': (init?: RequestInit) => {
        const body = JSON.parse(init!.body as string);
        return { ...EMPTY_GROUP, ...body };
      }
    });
    renderSync();
    await waitFor(() => expect(screen.getByText('Front porch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Renamed')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/sync-groups/g1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed' })
    }));
  });

  it('disables membership editing while the group is active, with a hint to deactivate first', async () => {
    const activeGroup = { ...EMPTY_GROUP, active: true, bitmask: 1 };
    stubFetchRoutes({ 'GET /api/controllers': CONTROLLERS, 'GET /api/sync-groups': [activeGroup] });
    renderSync();
    await waitFor(() => expect(screen.getByText('Front porch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Deactivate this sync group to change its members.')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /Cabinet/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it('deletes a group after confirming', async () => {
    const fetchMock = stubFetchRoutes({
      'GET /api/controllers': CONTROLLERS,
      'GET /api/sync-groups': [EMPTY_GROUP],
      'DELETE /api/sync-groups/g1': {}
    });
    renderSync();
    await waitFor(() => expect(screen.getByText('Front porch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete Front porch' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete sync group' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByText('No sync groups yet.')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/sync-groups/g1', expect.objectContaining({ method: 'DELETE' }));
  });
});
