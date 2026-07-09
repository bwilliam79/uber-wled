import { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  buildBackup, restoreBackup, buildThemesExport, importThemes,
  buildSchedulesExport, importSchedules, BackupFormatError
} from './service.js';

function attach(res: import('express').Response, filename: string): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

export function createBackupRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    attach(res, 'uber-wled-backup.json');
    res.json(buildBackup(db, new Date().toISOString()));
  });

  router.get('/themes', (_req, res) => {
    attach(res, 'uber-wled-themes.json');
    res.json(buildThemesExport(db, new Date().toISOString()));
  });

  router.get('/schedules', (_req, res) => {
    attach(res, 'uber-wled-schedules.json');
    res.json(buildSchedulesExport(db, new Date().toISOString()));
  });

  router.post('/restore', (req, res) => {
    try {
      res.json(restoreBackup(db, req.body));
    } catch (err) {
      if (err instanceof BackupFormatError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  router.post('/themes', (req, res) => {
    try {
      res.json(importThemes(db, req.body));
    } catch (err) {
      if (err instanceof BackupFormatError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  router.post('/schedules', (req, res) => {
    try {
      res.json(importSchedules(db, req.body));
    } catch (err) {
      if (err instanceof BackupFormatError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  return router;
}
