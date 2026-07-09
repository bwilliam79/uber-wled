import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './renderWithQuery';
import { ScheduleManager } from '../sections/schedule/ScheduleManager';

afterEach(() => vi.unstubAllGlobals());

function stub() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/schedules' && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => [] });
    }
    if (url === '/api/controllers') {
      return Promise.resolve({
        ok: true,
        json: async () => [{ id: 'c1', name: 'Cabinet', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null }]
      });
    }
    if (url === '/api/groups') {
      return Promise.resolve({
        ok: true,
        json: async () => [{ id: 'g1', name: 'Front', members: [{ controllerId: 'c1', wledSegId: 0 }] }]
      });
    }
    if (url === '/api/themes') {
      return Promise.resolve({
        ok: true,
        json: async () => [{ id: 't1', name: 'Spooky', effect: 2, palette: 6, colors: [[255, 140, 0]], brightness: 128, speed: 128, intensity: 128 }]
      });
    }
    if (url === '/api/controllers/c1/segments') {
      return Promise.resolve({
        ok: true,
        json: async () => [{ id: 0, start: 0, stop: 30, len: 30, on: true, bri: 90, fx: 5, pal: 3, col: [[10, 20, 30]] }]
      });
    }
    if (url === '/api/control/apply' && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ results: [{ controllerId: 'c1', wledSegId: 0, ok: true }] })
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openFormAndPreview(fetchMock: ReturnType<typeof stub>) {
  const openBtn = await screen.findByRole('button', { name: '+ New schedule' });
  await waitFor(() => expect((openBtn as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(openBtn);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Evenings' } });
  fireEvent.click(screen.getByLabelText('Mon'));
  fireEvent.click(screen.getByText('Preview'));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/control/apply')).toBe(true)
  );
}

describe('ScheduleManager v2', () => {
  it('previews the theme via fan-out v2 with the group target', async () => {
    const fetchMock = stub();
    renderWithQuery(<ScheduleManager />);
    await openFormAndPreview(fetchMock);
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/control/apply')!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      targets: [{ kind: 'group', groupId: 'g1' }],
      patch: { on: true, bri: 128, seg: { fxId: 2, palId: 6, col: [[255, 140, 0]], sx: 128, ix: 128 } }
    });
  });

  it('Discard reverts each member segment to its snapshot via v2 segment targets', async () => {
    const fetchMock = stub();
    renderWithQuery(<ScheduleManager />);
    await openFormAndPreview(fetchMock);
    fireEvent.click(screen.getByText('Discard'));
    await waitFor(() => {
      const applies = fetchMock.mock.calls.filter(([u]) => u === '/api/control/apply');
      expect(applies).toHaveLength(2);
      expect(JSON.parse((applies[1][1] as RequestInit).body as string)).toEqual({
        targets: [{ kind: 'segment', controllerId: 'c1', wledSegId: 0 }],
        patch: { seg: { on: true, bri: 90, fxId: 5, palId: 3, col: [[10, 20, 30]] } }
      });
    });
  });

  it('Approve reverts, then POSTs the schedule', async () => {
    const fetchMock = stub();
    renderWithQuery(<ScheduleManager />);
    await openFormAndPreview(fetchMock);
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u, i]) => u === '/api/schedules' && (i as RequestInit)?.method === 'POST')
      ).toBe(true)
    );
    const post = fetchMock.mock.calls.find(
      ([u, i]) => u === '/api/schedules' && (i as RequestInit)?.method === 'POST'
    )!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.triggerType).toBe('weekly');
    expect(body.daysOfWeek).toEqual([1]);
    expect(body.actionPayload).toEqual({ themeId: 't1' });
    expect(body.groupId).toBe('g1');
    expect(body.controllers).toBeNull();
  });

  it('previewing a controller-direct (whole-device) target snapshots every segment and applies via a controller-kind target', async () => {
    const fetchMock = stub();
    renderWithQuery(<ScheduleManager />);
    const openBtn = await screen.findByRole('button', { name: '+ New schedule' });
    await waitFor(() => expect((openBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(openBtn);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Direct' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByRole('radio', { name: 'Controller(s)' }));
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => u === '/api/control/apply')).toBe(true)
    );
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/control/apply')!;
    expect(JSON.parse((call[1] as RequestInit).body as string).targets).toEqual([
      { kind: 'controller', controllerId: 'c1' }
    ]);
    // The revert snapshot needs a concrete segment id per member, so a
    // whole-controller target expands to every one of that controller's
    // segments (just segment 0 here) rather than being unresolvable.
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/controllers/c1/segments')).toBe(true);
  });

  describe('editing an existing schedule', () => {
    function stubWithExisting() {
      const existing = {
        id: 's1', name: 'Evening glow', triggerType: 'weekly', cronExpr: null,
        daysOfWeek: [1, 3], timeOfDay: '19:00', offsetMinutes: 0, latitude: null, longitude: null,
        groupId: 'g1', controllers: null,
        actionType: 'theme', actionPayload: { themeId: 't1' }, enabled: true
      };
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (url === '/api/schedules' && method === 'GET') {
          return Promise.resolve({ ok: true, json: async () => [existing] });
        }
        if (url === '/api/controllers') {
          return Promise.resolve({
            ok: true,
            json: async () => [{ id: 'c1', name: 'Cabinet', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null }]
          });
        }
        if (url === '/api/groups') {
          return Promise.resolve({
            ok: true,
            json: async () => [{ id: 'g1', name: 'Front', members: [{ controllerId: 'c1', wledSegId: 0 }] }]
          });
        }
        if (url === '/api/themes') {
          return Promise.resolve({
            ok: true,
            json: async () => [{ id: 't1', name: 'Spooky', effect: 2, palette: 6, colors: [[255, 140, 0]], brightness: 128, speed: 128, intensity: 128 }]
          });
        }
        if (url === '/api/schedules/s1' && method === 'PATCH') {
          const body = JSON.parse(init!.body as string);
          return Promise.resolve({ ok: true, json: async () => ({ ...existing, ...body }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('shows the target and theme in the list, not just the name', async () => {
      stubWithExisting();
      renderWithQuery(<ScheduleManager />);
      await screen.findByText('Evening glow');
      expect(screen.getByText(/theme · Spooky · Group Front/)).toBeTruthy();
    });

    it('Edit pre-fills the form and PATCHes (not POST) on Save, skipping the preview dance entirely', async () => {
      const fetchMock = stubWithExisting();
      renderWithQuery(<ScheduleManager />);
      await screen.findByText('Evening glow');
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Evening glow');
      expect(screen.queryByText('Preview')).toBeNull(); // edit mode: straight to Save, no preview

      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Evening glow (later)' } });
      fireEvent.click(screen.getByText('Save'));

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith('/api/schedules/s1', expect.objectContaining({ method: 'PATCH' }))
      );
      const call = fetchMock.mock.calls.find(
        ([u, i]) => u === '/api/schedules/s1' && (i as RequestInit)?.method === 'PATCH'
      )!;
      expect(JSON.parse((call[1] as RequestInit).body as string).name).toBe('Evening glow (later)');
      await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull()); // modal closed
      expect(fetchMock.mock.calls.some(([u]) => u === '/api/control/apply')).toBe(false);
    });
  });
});
