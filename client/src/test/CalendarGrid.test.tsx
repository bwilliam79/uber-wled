import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CalendarGrid } from '../components/CalendarGrid';
import type { CalendarEvent } from '../api/client';

const events: CalendarEvent[] = [
  { id: 'e1', name: 'Halloween', category: 'holiday', dateRule: { kind: 'fixed', month: 10, day: 31 }, recursYearly: true, enabled: true, groupId: null, triggerTime: { type: 'fixed', time: '18:00' }, actionType: 'theme', actionPayload: {} },
  { id: 'e2', name: 'Party', category: 'custom', dateRule: { kind: 'fixed', month: 10, day: 15 }, recursYearly: true, enabled: false, groupId: null, triggerTime: { type: 'fixed', time: '20:00' }, actionType: 'theme', actionPayload: {} }
];

describe('CalendarGrid', () => {
  it('renders an enabled event chip (accent) on its day and a disabled chip (muted) on another', () => {
    render(<CalendarGrid events={events} year={2026} month={10} selectedDay={null} onSelectDay={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} onToday={vi.fn()} />);
    const day31 = screen.getByTestId('day-31');
    expect(within(day31).getByText('Halloween').className).toContain('enabled');
    const day15 = screen.getByTestId('day-15');
    expect(within(day15).getByText('Party').className).toContain('disabled');
  });

  it('calls onSelectDay when a day cell is clicked and onNext for the next-month control', () => {
    const onSelectDay = vi.fn();
    const onNext = vi.fn();
    render(<CalendarGrid events={events} year={2026} month={10} selectedDay={null} onSelectDay={onSelectDay} onPrev={vi.fn()} onNext={onNext} onToday={vi.fn()} />);
    fireEvent.click(screen.getByTestId('day-15'));
    expect(onSelectDay).toHaveBeenCalledWith(15);
    fireEvent.click(screen.getByLabelText(/next month/i));
    expect(onNext).toHaveBeenCalled();
  });
});
