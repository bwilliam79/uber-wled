import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createCalendarRepository, type CalendarEvent } from './repository.js';
import { resolveDate } from './dateRules.js';

/**
 * Checks whether `candidate` (an enabled event of one category) collides
 * with an existing enabled event of the opposite category on the same
 * resolved date for `year`. Same-category collisions are allowed — this is
 * how an "on at 5pm" / "off at 11pm" pair for one occasion is modeled.
 */
export function findConflict(
  events: CalendarEvent[],
  candidate: CalendarEvent,
  year: number
): CalendarEvent | undefined {
  if (!candidate.enabled) return undefined;
  const candidateDate = resolveDate(candidate.dateRule, year);
  if (!candidateDate) return undefined;

  return events.find((other) => {
    if (other.id === candidate.id) return false;
    if (!other.enabled) return false;
    if (other.category === candidate.category) return false;
    const otherDate = resolveDate(other.dateRule, year);
    return !!otherDate && otherDate.month === candidateDate.month && otherDate.day === candidateDate.day;
  });
}

/**
 * Checks whether `dateRule` resolves to a real date in at least one of the
 * current year or next year. A rule like "5th Monday of February" may be
 * impossible in some years (a 28-day February never has a 5th Monday) but
 * valid in others, so we only reject it if it fails for both years checked
 * — that's a strong signal the rule can never plausibly fire.
 */
function isResolvableSoon(dateRule: CalendarEvent['dateRule'], year: number): boolean {
  return !!resolveDate(dateRule, year) || !!resolveDate(dateRule, year + 1);
}

export function createCalendarRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createCalendarRepository(db);
  const thisYear = () => new Date().getFullYear();

  router.get('/', (_req, res) => {
    res.json(repo.list());
  });

  router.post('/', (req, res) => {
    const body = req.body;
    const candidate: CalendarEvent = {
      id: 'pending',
      name: body.name,
      category: body.category,
      dateRule: body.dateRule,
      recursYearly: body.recursYearly ?? true,
      enabled: body.enabled ?? false,
      groupId: body.groupId ?? null,
      controllerId: body.controllerId ?? null,
      wledSegId: body.wledSegId ?? null,
      triggerTime: body.triggerTime,
      actionType: body.actionType ?? null,
      actionPayload: body.actionPayload ?? null
    };

    if (!isResolvableSoon(candidate.dateRule, thisYear())) {
      return res.status(400).json({
        error: 'dateRule does not resolve to a valid date in the current or next year (e.g. an nthWeekday occurrence that does not exist)'
      });
    }

    const conflict = findConflict(repo.list(), candidate, thisYear());
    if (conflict) {
      const conflictDate = resolveDate(conflict.dateRule, thisYear())!;
      return res.status(409).json({
        error: 'a conflicting calendar event already exists on this date',
        conflict: { id: conflict.id, name: conflict.name, month: conflictDate.month, day: conflictDate.day }
      });
    }

    const { id, ...input } = candidate;
    res.status(201).json(repo.add(input));
  });

  router.patch('/:id', (req, res) => {
    const existing = repo.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'calendar event not found' });

    const candidate: CalendarEvent = { ...existing, ...req.body, id: existing.id };

    if (!isResolvableSoon(candidate.dateRule, thisYear())) {
      return res.status(400).json({
        error: 'dateRule does not resolve to a valid date in the current or next year (e.g. an nthWeekday occurrence that does not exist)'
      });
    }

    const others = repo.list().filter((e) => e.id !== existing.id);
    const conflict = findConflict(others, candidate, thisYear());
    if (conflict) {
      const conflictDate = resolveDate(conflict.dateRule, thisYear())!;
      return res.status(409).json({
        error: 'a conflicting calendar event already exists on this date',
        conflict: { id: conflict.id, name: conflict.name, month: conflictDate.month, day: conflictDate.day }
      });
    }

    res.json(repo.update(req.params.id, req.body));
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
