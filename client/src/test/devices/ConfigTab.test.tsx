import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfigTab } from '../../sections/devices/ConfigTab';
import { renderDevices, stubFetchRoutes } from './helpers';
import { PROBED_CFG } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

const GET_CFG = 'GET /api/controllers/c1/config';
const DRY = 'POST /api/controllers/c1/config?dryRun=1';
const APPLY = 'POST /api/controllers/c1/config';
const REBOOT = 'POST /api/controllers/c1/reboot';

function renderTab(routes: Record<string, unknown> = {}) {
  const fn = stubFetchRoutes({ [GET_CFG]: PROBED_CFG, ...routes });
  const utils = renderDevices(<ConfigTab controllerId="c1" />);
  return { fn, ...utils };
}

describe('ConfigTab', () => {
  it('loads the device config and seeds the Identity form from the probe', async () => {
    renderTab();
    expect(((await screen.findByLabelText('Device name')) as HTMLInputElement).value)
      .toBe('Cabinet Lights');
    expect((screen.getByLabelText('mDNS hostname') as HTMLInputElement).value)
      .toBe('cabinet-lights');
  });

  it('save runs the dry-run first and opens the diff modal', async () => {
    const { fn } = renderTab({
      [DRY]: { diff: [{ path: 'id.name', from: 'Cabinet Lights', to: 'Kitchen' }], rebootRequired: false }
    });
    fireEvent.change(await screen.findByLabelText('Device name'), { target: { value: 'Kitchen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save identity' }));
    expect(await screen.findByText('id.name')).toBeTruthy();
    const call = fn.mock.calls.find(([url]) => String(url).includes('dryRun=1'));
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      patch: { id: { name: 'Kitchen', mdns: 'cabinet-lights' } }
    });
  });

  it('confirm applies the same patch and toasts success (no reboot needed)', async () => {
    const { fn } = renderTab({
      [DRY]: { diff: [{ path: 'id.name', from: 'Cabinet Lights', to: 'Kitchen' }], rebootRequired: false },
      [APPLY]: { ok: true, rebootRequired: false }
    });
    fireEvent.change(await screen.findByLabelText('Device name'), { target: { value: 'Kitchen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save identity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 change' }));
    await screen.findByText('Config saved');
    const call = fn.mock.calls.find(
      ([url, init]) => String(url) === '/api/controllers/c1/config' && (init as RequestInit | undefined)?.method === 'POST'
    );
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      patch: { id: { name: 'Kitchen', mdns: 'cabinet-lights' } }
    });
  });

  it('an empty diff short-circuits to a "No changes" toast without a modal', async () => {
    renderTab({ [DRY]: { diff: [], rebootRequired: false } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save identity' }));
    expect(await screen.findByText('No changes to save')).toBeTruthy();
    expect(screen.queryByText('Review config changes')).toBeNull();
  });

  it('rebootRequired saves surface a Reboot now offer instead of rebooting silently', async () => {
    const { fn } = renderTab({
      [DRY]: { diff: [{ path: 'hw.led.total', from: 48, to: 49 }], rebootRequired: true },
      [APPLY]: { ok: true, rebootRequired: true },
      [REBOOT]: { ok: true }
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Save identity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 change' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reboot now' }));
    await waitFor(() => expect(fn).toHaveBeenCalledWith(
      '/api/controllers/c1/reboot', expect.objectContaining({ method: 'POST' })));
  });

  it('a failed dry-run toasts an error and opens nothing', async () => {
    renderTab(); // no DRY route registered → the stub rejects the dry-run fetch
    fireEvent.click(await screen.findByRole('button', { name: 'Save identity' }));
    expect(await screen.findByText('Could not preview changes')).toBeTruthy();
    expect(screen.queryByText('Review config changes')).toBeNull();
  });
});
