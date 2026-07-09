import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createThemeRepository } from './repository.js';
import { createControllerRepository } from '../controllers/repository.js';
import { getPresets, getPresetsRaw, getEffects, getPalettes } from '../wled/client.js';
import { classifyPresetImport, type RawPreset } from './presetImport.js';

/** WLED speed/intensity are 0–255; default to the mid value (128) when unset. */
function clamp255(v: unknown): number {
  return typeof v === 'number' && v >= 0 && v <= 255 ? Math.round(v) : 128;
}

export function createThemesRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createThemeRepository(db);
  const controllers = createControllerRepository(db);

  router.get('/', (_req, res) => res.json(repo.list()));

  router.post('/', (req, res) => {
    const { name, effect, palette, colors, brightness, speed, intensity } = req.body;
    res.status(201).json(repo.add({
      name, effect, palette, colors, brightness,
      speed: clamp255(speed), intensity: clamp255(intensity)
    }));
  });

  router.put('/:id', (req, res) => {
    const { name, effect, palette, colors, brightness, speed, intensity } = req.body;
    try {
      res.json(repo.update(req.params.id, {
        name, effect, palette, colors, brightness,
        speed: clamp255(speed), intensity: clamp255(intensity)
      }));
    } catch {
      res.status(404).json({ error: 'theme not found' });
    }
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  router.get('/presets/:controllerId', async (req, res) => {
    const controller = controllers.list().find((c) => c.id === req.params.controllerId);
    if (!controller) return res.status(404).json({ error: 'controller not found' });
    res.json(await getPresets(controller.host));
  });

  // Preview importing a controller's device presets as themes: maps each
  // preset to a theme and classifies it (new / already-imported / conflicts
  // with an existing theme of the same name). The client resolves conflicts
  // (rename or overwrite) and POSTs the chosen imports below.
  router.get('/preset-import/:controllerId', async (req, res) => {
    const controller = controllers.list().find((c) => c.id === req.params.controllerId);
    if (!controller) return res.status(404).json({ error: 'controller not found' });
    let raw: Record<string, RawPreset>;
    try {
      raw = (await getPresetsRaw(controller.host)) as Record<string, RawPreset>;
    } catch (err: any) {
      return res.status(503).json({ error: `controller ${controller.name} is unreachable: ${err.message}` });
    }
    res.json(classifyPresetImport(raw, repo.list()));
  });

  // Apply a resolved set of preset imports. Each entry either creates a new
  // theme or overwrites an existing one (overwriteThemeId) — the client omits
  // already-imported presets and applies the user's rename/overwrite choices.
  router.post('/preset-import', (req, res) => {
    const imports = Array.isArray(req.body?.imports) ? req.body.imports : [];
    let created = 0;
    let overwritten = 0;
    for (const item of imports) {
      const { name, effect, palette, colors, brightness, speed, intensity, overwriteThemeId } = item ?? {};
      if (typeof name !== 'string' || typeof effect !== 'number') continue;
      const theme = { name, effect, palette, colors, brightness, speed: clamp255(speed), intensity: clamp255(intensity) };
      if (overwriteThemeId) {
        try {
          repo.update(overwriteThemeId, theme);
          overwritten++;
        } catch {
          // Overwrite target vanished (deleted meanwhile) — fall back to create.
          repo.add(theme);
          created++;
        }
      } else {
        repo.add(theme);
        created++;
      }
    }
    res.json({ created, overwritten });
  });

  // Themes aren't tied to any one controller, so effect/palette names are
  // pulled from whichever configured controller responds first — tried in
  // name order, isolating each failure so one offline controller doesn't
  // block the rest.
  router.get('/effects-palettes', async (_req, res) => {
    for (const controller of controllers.list()) {
      try {
        const [effects, palettes] = await Promise.all([
          getEffects(controller.host),
          getPalettes(controller.host)
        ]);
        return res.json({
          effects, palettes,
          sourceControllerId: controller.id,
          sourceControllerName: controller.name
        });
      } catch {
        continue;
      }
    }
    res.json({ effects: [], palettes: [], sourceControllerId: null, sourceControllerName: null });
  });

  return router;
}
