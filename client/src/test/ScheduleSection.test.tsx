import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './renderWithQuery';
import { ScheduleSection } from '../sections/schedule/ScheduleSection';

afterEach(() => vi.unstubAllGlobals());

const halloween = {
  id: 'e1', name: 'Halloween', category: 'holiday',
  dateRule: { kind: 'fixed', month: 10, day: 31 }, recursYearly: true, enabled: true,
  groupId: 'g1', controllers: null, triggerTime: { type: 'fixed', time: '18:00' },
  offTrigger: null, actionType: 'theme', actionPayload: { themeId: 't1' }
};

function stub(events: unknown[] = [halloween], schedules: unknown[] = []) {
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
        json: async () => [{ id: 't1', name: 'Spooky', effect: 0, palette: 0, colors: [[0, 0, 0]], brightness: 128, speed: 128, intensity: 128 }]
      });
    }
    if (url.startsWith('/api/schedules')) {
      return Promise.resolve({ ok: true, json: async () => schedules });
    }
    return Promise.resolve({ ok: true, json: async () => [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ScheduleSection (unified list)', () => {
  it('renders a specific-date calendar event as a row with its resolved date, action and target', async () => {
    stub();
    renderWithQuery(<ScheduleSection />);
    expect(await screen.findByText('Halloween')).toBeTruthy();
    expect(screen.getByText(/Oct 31 · Spooky · Group Front/)).toBeTruthy();
  });

  it('shows the dashed "New schedule" add row', async () => {
    stub([]);
    renderWithQuery(<ScheduleSection />);
    expect(await screen.findByRole('button', { name: 'New schedule' })).toBeTruthy();
  });

  it('toggling a calendar-event row PATCHes enabled', async () => {
    const fetchMock = stub();
    renderWithQuery(<ScheduleSection />);
    await screen.findByText('Halloween');
    fireEvent.click(screen.getByRole('switch', { name: 'Halloween enabled' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) => String(u).startsWith('/api/calendar-events') && (i as RequestInit)?.method === 'PATCH'
        )
      ).toBe(true)
    );
  });

  it('clicking a calendar-event row opens a pre-filled edit form', async () => {
    stub();
    renderWithQuery(<ScheduleSection />);
    await screen.findByText('Halloween');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Halloween' }));
    await waitFor(() => expect((screen.getByLabelText('event name') as HTMLInputElement).value).toBe('Halloween'));
  });
});
