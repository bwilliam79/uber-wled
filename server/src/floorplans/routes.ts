import { Router } from 'express';
import multer from 'multer';
import type Database from 'better-sqlite3';
import { createFloorplanRepository } from './repository.js';

export function createFloorplansRouter(db: Database.Database, uploadDir: string): Router {
  const router = Router();
  const repo = createFloorplanRepository(db);
  const upload = multer({ dest: uploadDir });

  router.get('/', (_req, res) => {
    res.json(repo.list());
  });

  router.post('/', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'image file is required' });
    const created = repo.add({ name: req.body.name, imagePath: req.file.path });
    res.status(201).json(created);
  });

  router.patch('/:id', (req, res) => {
    try {
      const updated = repo.update(req.params.id, req.body);
      res.json(updated);
    } catch {
      res.status(404).json({ error: 'floorplan not found' });
    }
  });

  return router;
}
