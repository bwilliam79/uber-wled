export type DateRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nthWeekday'; month: number; weekday: number; n: number }
  | { kind: 'lastWeekday'; month: number; weekday: number }
  | { kind: 'easterOffset'; offsetDays: number }
  | { kind: 'oneOff'; year: number; month: number; day: number };

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  // month is 1-12
  const firstOfMonth = new Date(year, month - 1, 1);
  const firstWeekday = firstOfMonth.getDay();
  const dayOffset = (weekday - firstWeekday + 7) % 7;
  return 1 + dayOffset + (n - 1) * 7;
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const lastDate = new Date(year, month - 1, lastDayOfMonth);
  const diff = (lastDate.getDay() - weekday + 7) % 7;
  return lastDayOfMonth - diff;
}

/**
 * Computes Easter Sunday for a given year via the anonymous Gregorian
 * Computus algorithm.
 */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

export function resolveDate(rule: DateRule, year: number): { month: number; day: number } | null {
  switch (rule.kind) {
    case 'fixed':
      return { month: rule.month, day: rule.day };
    case 'nthWeekday':
      return { month: rule.month, day: nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.n) };
    case 'lastWeekday':
      return { month: rule.month, day: lastWeekdayOfMonth(year, rule.month, rule.weekday) };
    case 'easterOffset': {
      const easter = easterSunday(year);
      const base = new Date(year, easter.month - 1, easter.day);
      base.setDate(base.getDate() + rule.offsetDays);
      return { month: base.getMonth() + 1, day: base.getDate() };
    }
    case 'oneOff':
      return rule.year === year ? { month: rule.month, day: rule.day } : null;
  }
}
