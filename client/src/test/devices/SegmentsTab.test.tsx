import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SegmentsTab } from '../../sections/devices/SegmentsTab';
import { renderDevices, stubFetchRoutes } from './helpers';
import { SEGMENTS } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

function renderTab(routes: Record<string, unknown> = {}) {
  const fn = stubFetchRoutes({ 'GET /api/controllers/c1/segments': SEGMENTS, ...routes });
  const utils = renderDevices(<SegmentsTab controllerId="c1" ledCount={48} maxSeg={32} />);
  return { fn, ...utils };
}

describe('SegmentsTab', () => {
  it('renders one editor card per segment with the probed bounds', async () => {
    renderTab();
    const seg0 = await screen.findByTestId('segment-0');
    expect(screen.getByText('Segment 1')).toBeTruthy();
    expect((within(seg0).getByLabelText('Start') as HTMLInputElement).value).toBe('0');
    expect((within(seg0).getByLabelText('Stop') as HTMLInputElement).value).toBe('39');
    expect((within(seg0).getByLabelText('Name') as HTMLInputElement).value).toBe('Cabinet run');
  });

  it('validates bounds live and blocks Apply with an error', async () => {
    renderTab();
    const seg0 = await screen.findByTestId('segment-0');
    fireEvent.change(within(seg0).getByLabelText('Stop'), { target: { value: '49' } });
    expect(within(seg0).getByRole('alert').textContent).toMatch(/48/);
    expect((within(seg0).getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('PUTs the widened field set (name, not n) on Apply', async () => {
    const { fn } = renderTab({ 'PUT /api/controllers/c1/segments/0': SEGMENTS });
    const seg0 = await screen.findByTestId('segment-0');
    fireEvent.change(within(seg0).getByLabelText('Name'), { target: { value: 'Left run' } });
    fireEvent.change(within(seg0).getByLabelText('Stop'), { target: { value: '40' } });
    fireEvent.click(within(seg0).getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      const call = fn.mock.calls.find(([url]) => String(url).endsWith('/segments/0'));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
        name: 'Left run', start: 0, stop: 40, grp: 1, spc: 0, of: 0
      });
    });
  });

  it('applies live toggles (reverse) as single-field PUTs', async () => {
    const { fn } = renderTab({ 'PUT /api/controllers/c1/segments/1': SEGMENTS });
    await screen.findByTestId('segment-1');
    fireEvent.click(screen.getByRole('switch', { name: 'Segment 1 reverse' }));
    await waitFor(() => {
      const call = fn.mock.calls.find(([url]) => String(url).endsWith('/segments/1'));
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ rev: true });
    });
  });

  it('deletes a segment only after modal confirmation', async () => {
    const { fn } = renderTab({ 'DELETE /api/controllers/c1/segments/1': [SEGMENTS[0]] });
    const seg1 = await screen.findByTestId('segment-1');
    fireEvent.click(within(seg1).getByRole('button', { name: 'Delete' }));
    await screen.findByText(/Delete segment 1\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete segment' }));
    await waitFor(() => expect(fn).toHaveBeenCalledWith(
      '/api/controllers/c1/segments/1', expect.objectContaining({ method: 'DELETE' })));
  });

  it('creates a segment from the new-segment form', async () => {
    const { fn } = renderTab({
      'POST /api/controllers/c1/segments': [...SEGMENTS, { ...SEGMENTS[1], id: 2, start: 0, stop: 12 }]
    });
    const create = await screen.findByTestId('segment-create');
    fireEvent.change(within(create).getByLabelText('Start'), { target: { value: '0' } });
    fireEvent.change(within(create).getByLabelText('Stop'), { target: { value: '12' } });
    fireEvent.click(within(create).getByRole('button', { name: 'Add segment' }));
    await waitFor(() => {
      const call = fn.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ start: 0, stop: 12 });
    });
  });

  it('disables Add segment when every slot is used', async () => {
    const all = Array.from({ length: 32 }, (_, i) => ({ ...SEGMENTS[0], id: i }));
    stubFetchRoutes({ 'GET /api/controllers/c1/segments': all });
    renderDevices(<SegmentsTab controllerId="c1" ledCount={48} maxSeg={32} />);
    await screen.findByText('Segment 31');
    expect(screen.getByText(/All 32 segment slots are in use/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add segment' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
