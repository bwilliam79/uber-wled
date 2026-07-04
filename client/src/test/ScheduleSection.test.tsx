import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScheduleSection } from '../components/ScheduleSection';

afterEach(() => vi.unstubAllGlobals());

const halloween = {
  id: 'e1', name: 'Halloween', category: 'holiday', dateRule: { kind: 'fixed', month: 10, day: 31 },
  recursYearly: true, enabled: true, groupId: 'g1', triggerTime: { type: 'fixed', time: '18:00' }, actionType: 'theme', actionPayload: { themeId: 't1' }
};

function stub(events: unknown[] = [halloween]) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/calendar-events')) return Promise.resolve({ ok: true, json: async () => events });
    if (typeof url === 'string' && url.startsWith('/api/groups')) return Promise.resolve({ ok: true, json: async () => [{ id: 'g1', name: 'Front', members: [] }] });
    if (typeof url === 'string' && url.startsWith('/api/themes')) return Promise.resolve({ ok: true, json: async () => [{ id: 't1', name: 'Spooky', effect: 0, palette: 0, colors: [[0,0,0]], brightness: 128 }] });
    if (typeof url === 'string' && url.startsWith('/api/schedules')) return Promise.resolve({ ok: true, json: async () => [] });
    return Promise.resolve({ ok: true, json: async () => [] });
  }));
}

describe('ScheduleSection', () => {
  it('renders the calendar and shows a day panel with the override flag when an enabled event day is selected', async () => {
    stub();
    render(<ScheduleSection initialYear={2026} initialMonth={10} />);
    await waitFor(() => expect(screen.getByTestId('calendar-grid')).toBeTruthy());
    fireEvent.click(screen.getByTestId('day-31'));
    await waitFor(() => expect(screen.getByText(/Overrides the weekly schedule/i)).toBeTruthy());
  });

  it('shows the weekly recurring schedules region', async () => {
    stub([]);
    render(<ScheduleSection initialYear={2026} initialMonth={10} />);
    await waitFor(() => expect(screen.getByText(/Schedules/)).toBeTruthy());
  });
});
