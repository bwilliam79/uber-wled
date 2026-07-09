import express from 'express';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createControllersRouter } from './controllers/routes.js';
import { createSegmentsRouter } from './segments/routes.js';
import { createStripsRouter } from './strips/routes.js';
import { createRoomLabelsRouter } from './room_labels/routes.js';
import { createGroupsRouter } from './groups/routes.js';
import { createSyncGroupsRouter } from './sync/routes.js';
import { createThemesRouter } from './themes/routes.js';
import { createControlRouter } from './control/routes.js';
import { createSchedulesRouter } from './schedules/routes.js';
import { createCalendarRouter } from './calendar/routes.js';
import { createSettingsRouter } from './settings/routes.js';
import { createLiveRouter } from './live/routes.js';
import { createDevicesRouter } from './devices/routes.js';
import { createAppUpdateRouter } from './appUpdate/routes.js';
import { createBackupRouter } from './backup/routes.js';

export function createApp(db: Database.Database) {
  const app = express();
  // 25mb (vs the 100kb default) so a full-config restore payload fits.
  app.use(express.json({ limit: '25mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/controllers', createControllersRouter(db));
  app.use('/api/controllers/:controllerId/segments', createSegmentsRouter(db));
  app.use('/api/controllers/:controllerId', createDevicesRouter(db));

  app.use('/api/strips', createStripsRouter(db));
  app.use('/api/room-labels', createRoomLabelsRouter(db));
  app.use('/api/groups', createGroupsRouter(db));
  app.use('/api/sync-groups', createSyncGroupsRouter(db));
  app.use('/api/themes', createThemesRouter(db));
  app.use('/api/control', createControlRouter(db));
  app.use('/api/schedules', createSchedulesRouter(db));
  app.use('/api/calendar-events', createCalendarRouter(db));
  app.use('/api/settings', createSettingsRouter(db));
  app.use('/api/live', createLiveRouter(db));
  app.use('/api/app-update', createAppUpdateRouter(db));
  app.use('/api/backup', createBackupRouter(db));

  const staticDir = process.env.STATIC_DIR;
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  return app;
}
