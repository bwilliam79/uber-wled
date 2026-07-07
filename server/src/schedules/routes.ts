import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createScheduleRepository } from './repository.js';

export function createSchedulesRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createScheduleRepository(db);

  router.get('/', (_req, res) => res.json(repo.list()));

  router.post('/', (req, res) => {
    const body = req.body;
    const created = repo.add({
      name: body.name,
      triggerType: body.triggerType,
      cronExpr: body.cronExpr ?? null,
      daysOfWeek: body.daysOfWeek ?? null,
      timeOfDay: body.timeOfDay ?? null,
      offsetMinutes: body.offsetMinutes ?? 0,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      groupId: body.groupId ?? null,
      controllerId: body.controllerId ?? null,
      wledSegId: body.wledSegId ?? null,
      actionType: body.actionType,
      actionPayload: body.actionPayload,
      enabled: body.enabled ?? true
    });
    res.status(201).json(created);
  });

  router.patch('/:id', (req, res) => {
    try {
      res.json(repo.update(req.params.id, req.body));
    } catch {
      res.status(404).json({ error: 'schedule not found' });
    }
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
