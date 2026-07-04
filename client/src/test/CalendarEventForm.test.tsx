import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CalendarEventForm } from '../components/CalendarEventForm';

const groups = [{ id: 'g1', name: 'Porch', members: [] }];
const themes = [{ id: 't1', name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 }];

afterEach(() => vi.unstubAllGlobals());

describe('CalendarEventForm', () => {
  it('submits a fixed-date custom event', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'e1', name: 'Anniversary', category: 'custom',
        dateRule: { kind: 'fixed', month: 9, day: 12 }, recursYearly: true, enabled: true,
        groupId: 'g1', triggerTime: { type: 'fixed', time: '19:00' },
        actionType: 'theme', actionPayload: { themeId: 't1' }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const onCreated = vi.fn();
    render(<CalendarEventForm groups={groups} themes={themes} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/event name/i), { target: { value: 'Anniversary' } });
    fireEvent.change(screen.getByLabelText(/month/i), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: '12' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    // Verify the entered name/date are actually sent — not just that a POST happened.
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.name).toBe('Anniversary');
    expect(body.dateRule).toEqual({ kind: 'fixed', month: 9, day: 12 });
  });

  it('shows the conflicting event name when the server returns 409', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'a conflicting calendar event already exists on this date',
        conflict: { id: 'h1', name: 'July 4th', month: 7, day: 4 }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CalendarEventForm groups={groups} themes={themes} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/event name/i), { target: { value: "Dad's Birthday" } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByText(/July 4th/)).toBeTruthy());
  });
});
