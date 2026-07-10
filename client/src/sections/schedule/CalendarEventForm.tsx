import { useState } from 'react';
import {
  addCalendarEvent, updateCalendarEvent, ConflictError,
  type CalendarEvent, type Controller, type CustomTheme, type Group, type TriggerTime
} from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { resolveDate } from '../../lib/dateRules';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TargetPicker, type TargetValue } from './TargetPicker';
import { TriggerTimePicker } from './TriggerTimePicker';

function themeIdOf(event: CalendarEvent): string {
  return (event.actionPayload as { themeId?: string } | null)?.themeId ?? '';
}

export function CalendarEventForm({
  groups,
  controllers,
  live,
  themes,
  initialEvent,
  defaultDate,
  onCreated,
  onSaved
}: {
  groups: Group[];
  controllers: Controller[];
  live: Map<string, LiveStatusEntry>;
  themes: CustomTheme[];
  /** Present in edit mode — pre-fills the form and PATCHes this event
   *  instead of creating a new one. Its category (holiday vs custom) is
   *  preserved either way; this form only ever edits name/target/theme/time,
   *  plus the date when the event's dateRule is a plain fixed month/day
   *  (holidays defined by a computed rule like "4th Thursday of November"
   *  keep that rule as-is — this form has no UI for editing those rules). */
  initialEvent?: CalendarEvent;
  /** Prefills the month/day when creating a new event (e.g. from a clicked
   *  calendar day). Ignored in edit mode. */
  defaultDate?: { month: number; day: number };
  onCreated?: (event: CalendarEvent) => void;
  onSaved?: (event: CalendarEvent) => void;
}) {
  const fixedDate = initialEvent?.dateRule.kind === 'fixed' ? initialEvent.dateRule : null;
  const [name, setName] = useState(initialEvent?.name ?? '');
  const [month, setMonth] = useState(fixedDate?.month ?? defaultDate?.month ?? 1);
  const [day, setDay] = useState(fixedDate?.day ?? defaultDate?.day ?? 1);
  const [triggerTime, setTriggerTime] = useState<TriggerTime>(
    initialEvent?.triggerTime ?? { type: 'fixed', time: '18:00' }
  );
  const [offTrigger, setOffTrigger] = useState<TriggerTime | null>(initialEvent?.offTrigger ?? null);
  const [target, setTarget] = useState<TargetValue>(
    initialEvent
      ? { groupId: initialEvent.groupId, controllers: initialEvent.controllers }
      : { groupId: groups[0]?.id ?? null, controllers: null }
  );
  const [themeId, setThemeId] = useState(initialEvent ? themeIdOf(initialEvent) : (themes[0]?.id ?? ''));
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      if (initialEvent) {
        const saved = await updateCalendarEvent(initialEvent.id, {
          name,
          dateRule: fixedDate ? { kind: 'fixed', month, day } : initialEvent.dateRule,
          ...target,
          triggerTime,
          offTrigger,
          actionType: 'theme',
          actionPayload: { themeId }
        });
        onSaved?.(saved);
        return;
      }
      const created = await addCalendarEvent({
        name,
        category: 'custom',
        dateRule: { kind: 'fixed', month, day },
        recursYearly: true,
        enabled: true,
        ...target,
        triggerTime,
        offTrigger,
        actionType: 'theme',
        actionPayload: { themeId }
      });
      onCreated?.(created);
    } catch (err) {
      if (err instanceof ConflictError) {
        setError(
          `Conflicts with "${err.conflict.name}" on ${err.conflict.month}/${err.conflict.day}. Disable it first to save this event.`
        );
      } else {
        setError('Failed to save calendar event.');
      }
    }
  }

  return (
    <div className="calendar-event-form">
      <Field label="Event name" htmlFor="calendar-event-name">
        <input
          id="calendar-event-name" aria-label="event name" className="input"
          value={name} onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="form-row">
        {fixedDate || !initialEvent ? (
          <>
            <Field label="Month" htmlFor="calendar-event-month">
              <input
                id="calendar-event-month" aria-label="month" className="input" type="number"
                min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))}
              />
            </Field>
            <Field label="Day" htmlFor="calendar-event-day">
              <input
                id="calendar-event-day" aria-label="day" className="input" type="number"
                min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))}
              />
            </Field>
          </>
        ) : (
          <Field label="Date" htmlFor="calendar-event-computed-date">
            <p id="calendar-event-computed-date" className="control-label">
              {(() => {
                const resolved = resolveDate(initialEvent.dateRule, new Date().getFullYear());
                return resolved
                  ? `Computed date — ${resolved.month}/${resolved.day} this year, can't be edited here`
                  : "Computed date — can't be edited here";
              })()}
            </p>
          </Field>
        )}
      </div>
      <div className="calendar-event-triggers">
        <TriggerTimePicker
          idPrefix="calendar-event-on" label="Turn on"
          value={triggerTime} onChange={(v) => setTriggerTime(v ?? { type: 'fixed', time: '18:00' })}
        />
        <TriggerTimePicker
          idPrefix="calendar-event-off" label="Turn off"
          value={offTrigger} onChange={setOffTrigger} allowNone
        />
      </div>
      <TargetPicker
        idPrefix="calendar-event"
        groups={groups}
        controllers={controllers}
        live={live}
        value={target}
        onChange={setTarget}
      />
      <Field label="Theme" htmlFor="calendar-event-theme">
        <Select
          id="calendar-event-theme" label="event theme" showLabel={false} value={themeId} onChange={setThemeId}
          options={themes.map((t) => ({ value: t.id, label: t.name }))}
        />
      </Field>
      <Button variant="primary" onClick={handleSave}>Save</Button>
      {error && <div className="error-banner" role="alert">{error}</div>}
    </div>
  );
}
