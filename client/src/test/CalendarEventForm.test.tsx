import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CalendarEventForm } from '../sections/schedule/CalendarEventForm';

afterEach(() => vi.unstubAllGlobals());

const groups = [{ id: 'g1', name: 'Front', icon: null, sortOrder: 0, members: [] }];
const controllers: never[] = [];
const live = new Map();
const themes = [{ id: 't1', name: 'Spooky', effect: 0, palette: 0, colors: [[0, 0, 0]], brightness: 128 }];

describe('CalendarEventForm v2', () => {
  it('POSTs a fixed-date custom event and reports it to the parent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'e9', name: 'Bday' })
    });
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();
    render(<CalendarEventForm groups={groups} controllers={controllers} live={live} themes={themes} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('event name'), { target: { value: 'Bday' } });
    fireEvent.change(screen.getByLabelText('month'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('day'), { target: { value: '14' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.dateRule).toEqual({ kind: 'fixed', month: 3, day: 14 });
    expect(body.actionPayload).toEqual({ themeId: 't1' });
    expect(body.groupId).toBe('g1');
  });

  it('can target a specific controller directly instead of a group', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'e9' }) });
    vi.stubGlobal('fetch', fetchMock);
    const oneController = [
      { id: 'c1', name: 'cabinet-lights', host: '192.168.1.86', source: 'discovered' as const, stale: false, pinnedAssetPattern: null }
    ];
    render(
      <CalendarEventForm groups={groups} controllers={oneController} live={live} themes={themes} onCreated={() => {}} />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Controller(s)' }));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.groupId).toBeNull();
    expect(body.controllers).toEqual([{ controllerId: 'c1', wledSegId: null }]);
  });

  it('surfaces a 409 conflict as an inline error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'conflict', conflict: { id: 'x', name: 'Halloween', month: 10, day: 31 } })
    }));
    render(<CalendarEventForm groups={groups} controllers={controllers} live={live} themes={themes} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Halloween/));
  });

  describe('edit mode (initialEvent)', () => {
    const fixedDateEvent = {
      id: 'e1', name: 'Family Reunion', category: 'custom' as const,
      dateRule: { kind: 'fixed' as const, month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: 'g1', controllers: null,
      triggerTime: { type: 'fixed' as const, time: '17:00' },
      actionType: 'theme' as const, actionPayload: { themeId: 't1' }
    };
    const holidayEvent = {
      id: 'h1', name: 'Thanksgiving', category: 'holiday' as const,
      dateRule: { kind: 'nthWeekday' as const, month: 11, weekday: 4, n: 4 },
      recursYearly: true, enabled: true, groupId: null, controllers: null,
      triggerTime: { type: 'fixed' as const, time: '08:00' },
      actionType: null, actionPayload: null
    };

    it('pre-fills from the given event and PATCHes it (not POST) on save, reporting via onSaved', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...fixedDateEvent, name: 'Family Reunion (updated)' })
      });
      vi.stubGlobal('fetch', fetchMock);
      const onSaved = vi.fn();
      render(
        <CalendarEventForm groups={groups} controllers={controllers} live={live} themes={themes} initialEvent={fixedDateEvent} onSaved={onSaved} />
      );
      expect((screen.getByLabelText('event name') as HTMLInputElement).value).toBe('Family Reunion');
      expect((screen.getByLabelText('month') as HTMLInputElement).value).toBe('7');
      expect((screen.getByLabelText('day') as HTMLInputElement).value).toBe('4');
      expect((screen.getByLabelText('Turn on time') as HTMLInputElement).value).toBe('17:00');

      fireEvent.change(screen.getByLabelText('event name'), { target: { value: 'Family Reunion (updated)' } });
      fireEvent.click(screen.getByText('Save'));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/calendar-events/e1');
      expect((init as RequestInit).method).toBe('PATCH');
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.name).toBe('Family Reunion (updated)');
      expect(body.dateRule).toEqual({ kind: 'fixed', month: 7, day: 4 });
      // Unchanged ON trigger preserved; no OFF trigger by default.
      expect(body.triggerTime).toEqual({ type: 'fixed', time: '17:00' });
      expect(body.offTrigger).toBeNull();
    });

    it('lets the user set an ON=sunset trigger with an offset and an OFF=fixed time', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => fixedDateEvent });
      vi.stubGlobal('fetch', fetchMock);
      render(
        <CalendarEventForm groups={groups} controllers={controllers} live={live} themes={themes} initialEvent={fixedDateEvent} onSaved={vi.fn()} />
      );

      // ON -> Sunset, offset -15.
      fireEvent.change(screen.getByLabelText('Turn on'), { target: { value: 'sunset' } });
      fireEvent.change(screen.getByLabelText('Turn on offset minutes'), { target: { value: '-15' } });
      // OFF -> Fixed time 23:30.
      fireEvent.change(screen.getByLabelText('Turn off'), { target: { value: 'fixed' } });
      fireEvent.change(screen.getByLabelText('Turn off time'), { target: { value: '23:30' } });

      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.triggerTime).toEqual({ type: 'sunset', offsetMinutes: -15 });
      expect(body.offTrigger).toEqual({ type: 'fixed', time: '23:30' });
    });

    it('shows a read-only computed date (not editable inputs) for a non-fixed dateRule, and preserves it on save', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => holidayEvent });
      vi.stubGlobal('fetch', fetchMock);
      render(<CalendarEventForm groups={groups} controllers={controllers} live={live} themes={themes} initialEvent={holidayEvent} onSaved={() => {}} />);
      expect(screen.queryByLabelText('month')).toBeNull();
      expect(screen.queryByLabelText('day')).toBeNull();
      expect(screen.getByText(/Computed date/)).toBeTruthy();

      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.dateRule).toEqual({ kind: 'nthWeekday', month: 11, weekday: 4, n: 4 });
    });
  });
});
