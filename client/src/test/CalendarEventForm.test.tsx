import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CalendarEventForm } from '../sections/schedule/CalendarEventForm';

afterEach(() => vi.unstubAllGlobals());

const groups = [{ id: 'g1', name: 'Front', icon: null, sortOrder: 0, members: [] }];
const themes = [{ id: 't1', name: 'Spooky', effect: 0, palette: 0, colors: [[0, 0, 0]], brightness: 128 }];

describe('CalendarEventForm v2', () => {
  it('POSTs a fixed-date custom event and reports it to the parent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'e9', name: 'Bday' })
    });
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();
    render(<CalendarEventForm groups={groups} themes={themes} onCreated={onCreated} />);

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

  it('surfaces a 409 conflict as an inline error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'conflict', conflict: { id: 'x', name: 'Halloween', month: 10, day: 31 } })
    }));
    render(<CalendarEventForm groups={groups} themes={themes} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Halloween/));
  });
});
