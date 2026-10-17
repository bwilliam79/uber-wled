import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { createScheduleRepository, type Schedule } from '../schedules/repository.js';
import { resolveEntityMembers } from '../schedules/engine.js';
import { createThemeRepository } from '../themes/repository.js';
import { calendarLookExpiresAt } from './expiry.js';
import { isControllerIdle, polledOffSince } from './idle.js';
import { payloadThemeId } from './applyTracking.js';
import { createActiveLookRepository, type LookSource } from './repository.js';

const SOURCES: readonly LookSource[] = ['manual', 'calendar', 'schedule', 'game'];

function isLookSource(value: unknown): value is LookSource {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value);
}

/** Same target resolution the engine uses, so the preview lists the controllers a fire would consider. */
function scheduleMembers(db: Database.Database, schedule: Schedule) {
  return resolveEntityMembers(db, schedule);
}

export function createLooksRouter(db: Database.Database): Router {
  const router = Router();
  const looks = createActiveLookRepository(db);
  const controllers = createControllerRepository(db);
  const themes = createThemeRepository(db);
  const schedules = createScheduleRepository(db);

  router.get('/', (_req, res) => {
    res.json(looks.list());
  });

  // Registered before /:controllerId so "preview" is not captured as an id.
  router.get('/preview/:scheduleId', (req, res) => {
    const schedule = schedules.get(req.params.scheduleId);
    if (!schedule) return res.status(404).json({ error: 'schedule not found' });
    const scheduleThemeId = schedule.actionType === 'theme' ? payloadThemeId(schedule.actionPayload) : null;
    const now = new Date();
    const names = new Map(controllers.list().map((c) => [c.id, c.name]));
    const entries = scheduleMembers(db, schedule).map((member) => {
      const look = looks.get(member.controllerId) ?? null;
      return {
        controllerId: member.controllerId,
        controllerName: names.get(member.controllerId) ?? null,
        wledSegId: member.wledSegId,
        wouldAct: isControllerIdle(db, member.controllerId, scheduleThemeId, now),
        look,
        polledOff: look ? polledOffSince(db, member.controllerId, look.appliedAt) : false
      };
    });
    res.json({
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      scheduleThemeId,
      evaluatedAt: now.toISOString(),
      entries
    });
  });

  router.put('/:controllerId', (req, res) => {
    const controller = controllers.list().find((c) => c.id === req.params.controllerId);
    if (!controller) return res.status(404).json({ error: 'controller not found' });

    const body = (req.body ?? {}) as { themeId?: unknown; source?: unknown };
    const source = body.source === undefined || body.source === null ? 'manual' : body.source;
    if (!isLookSource(source)) return res.status(400).json({ error: 'invalid source' });
    if (typeof body.themeId !== 'string' || !themes.get(body.themeId)) {
      return res.status(400).json({ error: 'unknown theme' });
    }

    // Records state only — never contacts a device. Used to bootstrap a look
    // that was applied before tracking existed.
    const now = new Date();
    const look = looks.set({
      controllerId: controller.id,
      themeId: body.themeId,
      source,
      sourceId: null,
      appliedAt: now.toISOString(),
      expiresAt: source === 'calendar' ? calendarLookExpiresAt(now) : null
    });
    res.json(look);
  });

  router.delete('/:controllerId', (req, res) => {
    looks.clear(req.params.controllerId);
    res.status(204).end();
  });

  return router;
}
