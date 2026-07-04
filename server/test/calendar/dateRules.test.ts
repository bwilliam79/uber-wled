import { describe, it, expect } from 'vitest';
import { resolveDate, type DateRule } from '../../src/calendar/dateRules.js';

describe('resolveDate', () => {
  it('resolves a fixed date as-is', () => {
    const rule: DateRule = { kind: 'fixed', month: 7, day: 4 };
    expect(resolveDate(rule, 2026)).toEqual({ month: 7, day: 4 });
  });

  it('resolves the nth weekday of a month (3rd Monday of January = MLK Day 2026)', () => {
    const rule: DateRule = { kind: 'nthWeekday', month: 1, weekday: 1, n: 3 };
    expect(resolveDate(rule, 2026)).toEqual({ month: 1, day: 19 });
  });

  it('resolves the 5th occurrence of a weekday in a month that has five (May 2023 has 5 Mondays)', () => {
    const rule: DateRule = { kind: 'nthWeekday', month: 5, weekday: 1, n: 5 };
    expect(resolveDate(rule, 2023)).toEqual({ month: 5, day: 29 });
  });

  it('resolves the last weekday of a month that has only four occurrences (May 2026 has 4 Mondays)', () => {
    const rule: DateRule = { kind: 'lastWeekday', month: 5, weekday: 1 };
    expect(resolveDate(rule, 2026)).toEqual({ month: 5, day: 25 });
  });

  it('resolves the last weekday of a month that has five occurrences (May 2023 has 5 Mondays)', () => {
    const rule: DateRule = { kind: 'lastWeekday', month: 5, weekday: 1 };
    expect(resolveDate(rule, 2023)).toEqual({ month: 5, day: 29 });
  });

  it('returns null for an impossible nth-weekday occurrence (5th Monday of February 2026, which only has 4 Mondays)', () => {
    const rule: DateRule = { kind: 'nthWeekday', month: 2, weekday: 1, n: 5 };
    expect(resolveDate(rule, 2026)).toBeNull();
  });

  it('resolves Easter Sunday itself via easterOffset 0 (known date: 2024-03-31)', () => {
    const rule: DateRule = { kind: 'easterOffset', offsetDays: 0 };
    expect(resolveDate(rule, 2024)).toEqual({ month: 3, day: 31 });
  });

  it('resolves Easter Sunday for a second known year (2025-04-20)', () => {
    const rule: DateRule = { kind: 'easterOffset', offsetDays: 0 };
    expect(resolveDate(rule, 2025)).toEqual({ month: 4, day: 20 });
  });

  it('resolves an easterOffset with a non-zero offset (e.g. Good Friday, -2 days, for 2026 Easter of April 5)', () => {
    const rule: DateRule = { kind: 'easterOffset', offsetDays: -2 };
    expect(resolveDate(rule, 2026)).toEqual({ month: 4, day: 3 });
  });

  it('resolves a oneOff rule only for its stored year', () => {
    const rule: DateRule = { kind: 'oneOff', year: 2026, month: 9, day: 12 };
    expect(resolveDate(rule, 2026)).toEqual({ month: 9, day: 12 });
    expect(resolveDate(rule, 2027)).toBeNull();
  });
});
