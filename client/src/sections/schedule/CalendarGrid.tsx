import type { CalendarEvent } from '../../api/client';
import { resolveDate } from '../../lib/dateRules';
import { Button } from '../../components/ui/Button';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function eventsForDay(
  events: CalendarEvent[], year: number, month: number, day: number
): CalendarEvent[] {
  return events.filter((e) => {
    const d = resolveDate(e.dateRule, year);
    return !!d && d.month === month && d.day === day;
  });
}

export function CalendarGrid({
  events, year, month, selectedDay, onSelectDay, onPrev, onNext, onToday
}: {
  events: CalendarEvent[];
  year: number;
  month: number;
  selectedDay: number | null;
  onSelectDay: (day: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="calendar" data-testid="calendar-grid">
      <div className="calendar-header">
        <Button variant="ghost" aria-label="previous month" onClick={onPrev}>‹</Button>
        <h3 className="calendar-title">{MONTHS[month - 1]} {year}</h3>
        <div className="calendar-header-actions">
          <Button variant="secondary" onClick={onToday}>Today</Button>
          <Button variant="ghost" aria-label="next month" onClick={onNext}>›</Button>
        </div>
      </div>
      <div className="calendar-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar-weekday">{w}</div>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((day, idx) =>
          day === null ? (
            <div key={`pad-${idx}`} className="calendar-cell empty" />
          ) : (
            <button
              key={day}
              type="button"
              data-testid={`day-${day}`}
              className={`calendar-cell${selectedDay === day ? ' selected' : ''}`}
              onClick={() => onSelectDay(day)}
            >
              <span className="calendar-day-num">{day}</span>
              <span className="calendar-chips">
                {eventsForDay(events, year, month, day).map((e) => (
                  <span
                    key={e.id}
                    className={`event-chip ${e.enabled ? 'enabled' : 'disabled'} ${e.category}`}
                  >
                    {e.name}
                  </span>
                ))}
              </span>
            </button>
          )
        )}
      </div>
    </div>
  );
}
