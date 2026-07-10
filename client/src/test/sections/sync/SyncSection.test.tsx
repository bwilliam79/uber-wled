import type { ReactElement, ReactNode } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../../components/ui/Toast';
import { SyncSection } from '../../../sections/sync/SyncSection';

const { liveMap } = vi.hoisted(() => ({ liveMap: new Map() }));
vi.mock('../../../api/live', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/live')>();
  return { ...actual, useLiveStatus: () => liveMap };
});

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

type RouteEntry =
  | unknown
  | ((init?: RequestInit) => unknown)
  | { status: number; body: unknown }
  | ((init?: RequestInit) => { status: number; body: unknown });

function stubFetchRoutes(routes: Record<string, RouteEntry>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    if (!(key in routes)) throw new Error(`unexpected fetch: ${key}`);
    const entry = routes[key];
    const resolved = typeof entry === 'function' ? entry(init) : entry;
    const isStatusBody =
      resolved !== null &&
      typeof resolved === 'object' &&
      'status' in (resolved as object) &&
      'body' in (resolved as object);
    const status = isStatusBody ? (resolved as { status: number }).status : 200;
    const body = isStatusBody ? (resolved as { body: unknown }).body : resolved;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => structuredClone(body)
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const EMPTY_GROUP = { id: 'g1', name: 'Front porch', active: false, bitmask: null, memberControllerIds: ['c1'] };

afterEach(() => {
  vi.unstubAllGlobals();
  liveMap.clear();
});

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

  it('prefers the live device-reported name over the stored controller name, in both the member list and the create-modal picker', async () => {
    liveMap.set('c1', { reachable: true, state: {}, info: { name: 'Cabinet Lights v2', ver: '16.0.0', leds: { count: 48 }, arch: 'esp32' } });
    stubFetchRoutes({ 'GET /api/controllers': CONTROLLERS, 'GET /api/sync-groups': [EMPTY_GROUP] });
    renderSync();
    await waitFor(() => expect(screen.getByText('Front porch')).toBeTruthy());
    expect(screen.getByText('Cabinet Lights v2')).toBeTruthy();
    expect(screen.queryByText('Cabinet', { exact: true })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'New sync group' }));
    expect(screen.getByRole('checkbox', { name: 'Cabinet Lights v2' })).toBeTruthy();
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

  it('surfaces an active-membership conflict on the row and disables Activate', async () => {
    const activeGroup = {
      id: 'g-active', name: 'Front porch', active: true, bitmask: 1, memberControllerIds: ['c1']
    };
    const blocked = {
      id: 'g-blocked', name: 'Back yard', active: false, bitmask: null, memberControllerIds: ['c1', 'c2']
    };
    stubFetchRoutes({
      'GET /api/controllers': CONTROLLERS,
      'GET /api/sync-groups': [activeGroup, blocked]
    });
    renderSync();
    await waitFor(() => expect(screen.getByText('Back yard')).toBeTruthy());
    expect(screen.getByText(/already active in “Front porch”/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Activate Back yard' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('labels controllers that are active in another group in the create modal', async () => {
    const activeGroup = {
      id: 'g-active', name: 'Front porch', active: true, bitmask: 1, memberControllerIds: ['c1']
    };
    stubFetchRoutes({
      'GET /api/controllers': CONTROLLERS,
      'GET /api/sync-groups': [activeGroup]
    });
    renderSync();
    await waitFor(() => expect(screen.getByText('Front porch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'New sync group' }));
    expect(screen.getByText('Active in “Front porch”')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Cabinet/ }));
    expect(screen.getByText(/only be active in one sync group at a time/)).toBeTruthy();
  });

  it('toasts the server conflict message when activate fails with 409', async () => {
    stubFetchRoutes({
      'GET /api/controllers': CONTROLLERS,
      'GET /api/sync-groups': [EMPTY_GROUP],
      'POST /api/sync-groups/g1/activate': {
        status: 409,
        body: {
          error:
            '"Cabinet" is already active in sync group "Other". Deactivate that group first, or remove the shared controller from one of them.'
        }
      }
    });
    renderSync();
    await waitFor(() => expect(screen.getByText('Front porch')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Activate Front porch' }));
    await waitFor(() => expect(screen.getByText(/Could not activate Front porch/)).toBeTruthy());
    expect(screen.getByText(/"Cabinet" is already active in sync group "Other"/)).toBeTruthy();
  });
});
