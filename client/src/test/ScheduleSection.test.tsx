import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './renderWithQuery';
import { ScheduleSection } from '../sections/schedule/ScheduleSection';

afterEach(() => vi.unstubAllGlobals());

const halloween = {
  id: 'e1', name: 'Halloween', category: 'holiday',
  dateRule: { kind: 'fixed', month: 10, day: 31 }, recursYearly: true, enabled: true,
  groupId: 'g1', triggerTime: { type: 'fixed', time: '18:00' },
  actionType: 'theme', actionPayload: { themeId: 't1' }
};

function stub(events: unknown[] = [halloween]) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/calendar-events') && method === 'PATCH') {
      return Promise.resolve({ ok: true, json: async () => ({ ...halloween, enabled: false }) });
    }
    if (url.startsWith('/api/calendar-events')) {
      return Promise.resolve({ ok: true, json: async () => events });
    }
    if (url.startsWith('/api/groups')) {
      return Promise.resolve({ ok: true, json: async () => [{ id: 'g1', name: 'Front', members: [] }] });
    }
    if (url.startsWith('/api/themes')) {
      return Promise.resolve({
        ok: true,
        json: async () => [{ id: 't1', name: 'Spooky', effect: 0, palette: 0, colors: [[0, 0, 0]], brightness: 128 }]
      });
    }
    if (url.startsWith('/api/schedules')) {
      return Promise.resolve({ ok: true, json: async () => [] });
    }
    return Promise.resolve({ ok: true, json: async () => [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ScheduleSection v2', () => {
  it('opens a day overlay with the override badge when a day that has an enabled event is clicked', async () => {
    stub();
    renderWithQuery(<ScheduleSection initialYear={2026} initialMonth={10} />);
    // Wait for the event chip to render so the click sees the loaded events.
    await screen.findByText('Halloween');
    fireEvent.click(screen.getByTestId('day-31'));
    await waitFor(() => expect(screen.getByText(/Overrides the weekly schedule/i)).toBeTruthy());
    expect(screen.getByText(/theme · Spooky/)).toBeTruthy();
  });

  it('clicking an empty day opens the create form prefilled with that date', async () => {
    stub([]); // no events → every day is empty
    renderWithQuery(<ScheduleSection initialYear={2026} initialMonth={10} />);
    await waitFor(() => expect(screen.getByTestId('calendar-grid')).toBeTruthy());
    fireEvent.click(screen.getByTestId('day-12'));
    // The create form opens with the clicked day's date prefilled.
    expect((await screen.findByLabelText('month') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('day') as HTMLInputElement).value).toBe('12');
    expect(screen.getByText('New calendar event')).toBeTruthy();
  });

  it('toggling an event PATCHes enabled', async () => {
    const fetchMock = stub();
    renderWithQuery(<ScheduleSection initialYear={2026} initialMonth={10} />);
    await screen.findByText('Halloween');
    fireEvent.click(screen.getByTestId('day-31'));
    fireEvent.click(await screen.findByLabelText('Halloween enabled'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/calendar-events/e1', expect.objectContaining({ method: 'PATCH' }))
    );
  });

  it('shows the calendar by default and the weekly schedules under the Weekly tab', async () => {
    stub([]);
    renderWithQuery(<ScheduleSection initialYear={2026} initialMonth={10} />);
    await waitFor(() => expect(screen.getByTestId('calendar-grid')).toBeTruthy());
    // Weekly schedules aren't shown on the Calendar tab.
    expect(screen.queryByText('Weekly schedules')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Weekly' }));
    await waitFor(() => expect(screen.getByText('Weekly schedules')).toBeTruthy());
    // Switching to Weekly hides the calendar.
    expect(screen.queryByTestId('calendar-grid')).toBeNull();
  });

  it('marks a configured holiday (theme + enabled) distinctly from an unconfigured one', async () => {
    const configured = { ...halloween, id: 'c1', name: 'Halloween', enabled: true, actionType: 'theme' };
    const placeholder = {
      id: 'p1', name: 'Thanksgiving', category: 'holiday',
      dateRule: { kind: 'fixed', month: 10, day: 15 }, recursYearly: true, enabled: true,
      groupId: null, triggerTime: { type: 'fixed', time: '18:00' }, actionType: null, actionPayload: null
    };
    stub([configured, placeholder]);
    renderWithQuery(<ScheduleSection initialYear={2026} initialMonth={10} />);
    const configuredChip = await screen.findByText('Halloween');
    const placeholderChip = await screen.findByText('Thanksgiving');
    expect(configuredChip.className).toContain('configured');
    expect(placeholderChip.className).toContain('unconfigured');
  });

  it('Edit opens a pre-filled form and PATCHes the event on save, including for a holiday', async () => {
    // Regression: there was previously no way to edit an existing calendar
    // event at all (holiday or custom) — only toggle enabled/Remove, or
    // create a brand new one. This is the "I don't see any way to set a
    // theme for a holiday entry" gap.
    const fetchMock = stub();
    renderWithQuery(<ScheduleSection initialYear={2026} initialMonth={10} />);
    await screen.findByText('Halloween');
    fireEvent.click(screen.getByTestId('day-31'));
    fireEvent.click(await screen.findByText('Edit'));
    expect((await screen.findByLabelText('event name') as HTMLInputElement).value).toBe('Halloween');
    fireEvent.change(screen.getByLabelText('event name'), { target: { value: 'Halloween (spookier)' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/calendar-events/e1', expect.objectContaining({ method: 'PATCH' }))
    );
    const call = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/calendar-events/e1' && (init as RequestInit)?.method === 'PATCH'
    );
    expect(JSON.parse((call![1] as RequestInit).body as string).name).toBe('Halloween (spookier)');
    await waitFor(() => expect(screen.queryByLabelText('event name')).toBeNull());
  });
});
