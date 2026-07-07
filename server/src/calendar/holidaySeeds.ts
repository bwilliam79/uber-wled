import type { DateRule } from './dateRules.js';

export interface HolidaySeed {
  name: string;
  category: 'holiday';
  dateRule: DateRule;
  recursYearly: true;
  enabled: false;
  groupId: null;
  controllerId: null;
  wledSegId: null;
  triggerTime: { type: 'fixed'; time: string };
  actionType: null;
  actionPayload: null;
}

/**
 * ~20 combined federal + common decorating-occasion holidays, per the
 * scheduling spec. Seeded disabled with no group/action — inert until the
 * user configures them, to avoid any surprise light changes.
 */
export function seedHolidays(): HolidaySeed[] {
  const base = {
    category: 'holiday' as const,
    recursYearly: true as const,
    enabled: false as const,
    groupId: null,
    controllerId: null,
    wledSegId: null,
    triggerTime: { type: 'fixed' as const, time: '18:00' },
    actionType: null,
    actionPayload: null
  };

  return [
    { ...base, name: "New Year's Day", dateRule: { kind: 'fixed', month: 1, day: 1 } },
    { ...base, name: 'MLK Day', dateRule: { kind: 'nthWeekday', month: 1, weekday: 1, n: 3 } },
    { ...base, name: "Valentine's Day", dateRule: { kind: 'fixed', month: 2, day: 14 } },
    { ...base, name: 'Presidents Day', dateRule: { kind: 'nthWeekday', month: 2, weekday: 1, n: 3 } },
    { ...base, name: "St. Patrick's Day", dateRule: { kind: 'fixed', month: 3, day: 17 } },
    { ...base, name: 'Easter', dateRule: { kind: 'easterOffset', offsetDays: 0 } },
    { ...base, name: 'Memorial Day', dateRule: { kind: 'lastWeekday', month: 5, weekday: 1 } },
    { ...base, name: 'Juneteenth', dateRule: { kind: 'fixed', month: 6, day: 19 } },
    { ...base, name: 'July 4th', dateRule: { kind: 'fixed', month: 7, day: 4 } },
    { ...base, name: 'Labor Day', dateRule: { kind: 'nthWeekday', month: 9, weekday: 1, n: 1 } },
    { ...base, name: 'Columbus Day', dateRule: { kind: 'nthWeekday', month: 10, weekday: 1, n: 2 } },
    { ...base, name: 'Halloween', dateRule: { kind: 'fixed', month: 10, day: 31 } },
    { ...base, name: 'Veterans Day', dateRule: { kind: 'fixed', month: 11, day: 11 } },
    { ...base, name: 'Thanksgiving', dateRule: { kind: 'nthWeekday', month: 11, weekday: 4, n: 4 } },
    { ...base, name: 'Christmas Eve', dateRule: { kind: 'fixed', month: 12, day: 24 } },
    { ...base, name: 'Christmas Day', dateRule: { kind: 'fixed', month: 12, day: 25 } },
    { ...base, name: "New Year's Eve", dateRule: { kind: 'fixed', month: 12, day: 31 } }
  ];
}
