import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CalendarGrid, eventsForDay } from '../sections/schedule/CalendarGrid';
import type { CalendarEvent } from '../api/client';

const halloween: CalendarEvent = {
  id: 'e1', name: 'Halloween', category: 'holiday',
  dateRule: { kind: 'fixed', month: 10, day: 31 }, recursYearly: true, enabled: true,
  groupId: 'g1', controllerId: null, wledSegId: null, triggerTime: { type: 'fixed', time: '18:00' },
  actionType: 'theme', actionPayload: { themeId: 't1' }
};

describe('CalendarGrid v2', () => {
  it('renders day cells with event chips and reports day selection', () => {
    const onSelectDay = vi.fn();
    render(
      <CalendarGrid
        events={[halloween]} year={2026} month={10} selectedDay={null}
        onSelectDay={onSelectDay} onPrev={() => {}} onNext={() => {}} onToday={() => {}}
      />
    );
    expect(screen.getByTestId('calendar-grid')).toBeTruthy();
    expect(within(screen.getByTestId('day-31')).getByText('Halloween')).toBeTruthy();
    fireEvent.click(screen.getByTestId('day-14'));
    expect(onSelectDay).toHaveBeenCalledWith(14);
  });

  it('wires prev/next/today buttons', () => {
    const onPrev = vi.fn(); const onNext = vi.fn(); const onToday = vi.fn();
    render(
      <CalendarGrid
        events={[]} year={2026} month={10} selectedDay={null}
        onSelectDay={() => {}} onPrev={onPrev} onNext={onNext} onToday={onToday}
      />
    );
    fireEvent.click(screen.getByLabelText('previous month'));
    fireEvent.click(screen.getByLabelText('next month'));
    fireEvent.click(screen.getByText('Today'));
    expect(onPrev).toHaveBeenCalled();
    expect(onNext).toHaveBeenCalled();
    expect(onToday).toHaveBeenCalled();
  });

  it('eventsForDay resolves fixed date rules', () => {
    expect(eventsForDay([halloween], 2026, 10, 31)).toHaveLength(1);
    expect(eventsForDay([halloween], 2026, 10, 30)).toHaveLength(0);
  });
});
