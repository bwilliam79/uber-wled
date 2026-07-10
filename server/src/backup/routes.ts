import { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  buildBackup, restoreBackup, buildThemesExport, importThemes,
  buildSchedulesExport, importSchedules, BackupFormatError
} from './service.js';
import {
  autoBackupDir, listAutoBackups, readAutoBackup, restoreAutoBackup, isAutoBackupName
} from './autoBackup.js';

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

  // --- Server-side nightly auto-backups (kept next to the DB) ---
  const dir = () => autoBackupDir(db.name);

  router.get('/auto', (_req, res) => res.json(listAutoBackups(dir())));

  router.get('/auto/:name', (req, res) => {
    if (!isAutoBackupName(req.params.name)) return res.status(400).json({ error: 'invalid name' });
    try {
      attach(res, req.params.name);
      res.send(readAutoBackup(dir(), req.params.name));
    } catch {
      return res.status(404).json({ error: 'not found' });
    }
  });

  router.post('/auto/:name/restore', (req, res) => {
    if (!isAutoBackupName(req.params.name)) return res.status(400).json({ error: 'invalid name' });
    try {
      res.json(restoreAutoBackup(db, dir(), req.params.name));
    } catch (err) {
      if (err instanceof BackupFormatError) return res.status(400).json({ error: err.message });
      return res.status(404).json({ error: 'not found' });
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
