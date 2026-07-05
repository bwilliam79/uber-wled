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
  it('shows the day panel with the override badge when an enabled event day is selected', async () => {
    stub();
    renderWithQuery(<ScheduleSection initialYear={2026} initialMonth={10} />);
    await waitFor(() => expect(screen.getByTestId('calendar-grid')).toBeTruthy());
    fireEvent.click(screen.getByTestId('day-31'));
    await waitFor(() => expect(screen.getByText(/Overrides the weekly schedule/i)).toBeTruthy());
    expect(screen.getByText(/theme · Spooky/)).toBeTruthy();
  });

  it('toggling an event PATCHes enabled', async () => {
    const fetchMock = stub();
    renderWithQuery(<ScheduleSection initialYear={2026} initialMonth={10} />);
    await waitFor(() => expect(screen.getByTestId('calendar-grid')).toBeTruthy());
    fireEvent.click(screen.getByTestId('day-31'));
    fireEvent.click(await screen.findByLabelText('Halloween enabled'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/calendar-events/e1', expect.objectContaining({ method: 'PATCH' }))
    );
  });

  it('renders the weekly schedules region', async () => {
    stub([]);
    renderWithQuery(<ScheduleSection initialYear={2026} initialMonth={10} />);
    await waitFor(() => expect(screen.getByText('Weekly schedules')).toBeTruthy());
  });
});
