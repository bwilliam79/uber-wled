import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import {
  applyControlPatch,
  expandTargets,
  GroupNotFoundError,
  type ApplyResult,
  type ControlPatch,
  type Target
} from '../control/applyV2.js';
import { actionToPatch } from '../control/actionMap.js';
import { trackManualApply } from '../looks/applyTracking.js';
import { createControllerRepository } from '../controllers/repository.js';
import { createGroupRepository } from '../groups/repository.js';
import { createThemeRepository, type CustomTheme } from '../themes/repository.js';

/**
 * Siri / iOS Shortcuts apply.
 *
 * POST /apply only. There is no GET variant: turning lights on or off is
 * state-changing, and a state-changing GET is unsafe — link previews and
 * prefetch could trigger it.
 */
export function createShortcutsRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/apply', async (req, res) => {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      return reply(req, res, 400, { error: 'invalid body' }, 'invalid body');
    }
    const body = req.body as {
      theme?: unknown;
      action?: unknown;
      group?: unknown;
      controllers?: unknown;
      dryRun?: unknown;
    };

    if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
      return reply(req, res, 400, { error: 'dryRun must be a boolean' }, 'dryRun must be a boolean');
    }

    let action: 'theme' | 'off';
    if (body.action === undefined) action = 'theme';
    else if (body.action === 'theme' || body.action === 'off') action = body.action;
    else {
      const error = 'action must be "theme" or "off"';
      return reply(req, res, 400, { error }, error);
    }

    if (body.group !== undefined && body.group !== null && typeof body.group !== 'string') {
      const error = 'group must be a string';
      return reply(req, res, 400, { error }, error);
    }
    if (body.controllers !== undefined && body.controllers !== null && !Array.isArray(body.controllers)) {
      const error = 'controllers must be an array of names or ids';
      return reply(req, res, 400, { error }, error);
    }

    const groupQuery = typeof body.group === 'string' && body.group.trim() !== '' ? body.group : undefined;
    const controllerQueries = Array.isArray(body.controllers) ? body.controllers : undefined;
    const hasGroup = groupQuery !== undefined;
    const hasControllers = !!controllerQueries && controllerQueries.length > 0;
    if ((hasGroup && hasControllers) || (!hasGroup && !hasControllers)) {
      const error = 'exactly one of group or controllers is required';
      return reply(req, res, 400, { error }, error);
    }
    if (hasControllers && controllerQueries.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
      const error = 'controllers must be an array of names or ids';
      return reply(req, res, 400, { error }, error);
    }

    const themes = createThemeRepository(db);
    const groups = createGroupRepository(db);
    const controllers = createControllerRepository(db);

    // `theme` is required for a theme apply and ignored for off — an unknown
    // name must not 404 a lights-off request.
    let theme: CustomTheme | null = null;
    if (action === 'theme') {
      if (typeof body.theme !== 'string' || body.theme.trim() === '') {
        const error = 'theme is required when action is "theme"';
        return reply(req, res, 400, { error }, error);
      }
      const resolved = resolveNamed(themes.list(), body.theme, 'theme');
      if (isResolveError(resolved)) return reply(req, res, resolved.status, { error: resolved.error }, resolved.error);
      theme = resolved;
    }

    let targets: Target[];
    if (groupQuery !== undefined) {
      const resolved = resolveNamed(groups.list(), groupQuery, 'group');
      if (isResolveError(resolved)) return reply(req, res, resolved.status, { error: resolved.error }, resolved.error);
      targets = [{ kind: 'group', groupId: resolved.id }];
    } else {
      targets = [];
      for (const query of controllerQueries ?? []) {
        if (typeof query !== 'string') {
          const error = 'controllers must be an array of names or ids';
          return reply(req, res, 400, { error }, error);
        }
        const resolved = resolveNamed(controllers.list(), query, 'controller');
        if (isResolveError(resolved)) return reply(req, res, resolved.status, { error: resolved.error }, resolved.error);
        targets.push({ kind: 'controller', controllerId: resolved.id });
      }
    }

    const patch: ControlPatch = theme
      ? {
          on: true,
          ...actionToPatch({ type: 'theme', themeId: theme.id }, (id) => themes.get(id)),
          themeId: theme.id
        }
      : { on: false };
    const label = theme ? theme.name : 'Lights off';

    try {
      if (body.dryRun === true) {
        const total = new Set(expandTargets(db, targets).map((target) => target.controllerId)).size;
        const message = speakable(label, total, total);
        return reply(req, res, 200, {
          dryRun: true,
          action,
          theme: theme ? { id: theme.id, name: theme.name } : null,
          targets,
          patch,
          message
        }, message);
      }

      const results = await applyControlPatch(db, targets, patch);
      trackManualApply(db, patch, results);
      const { okCount, total } = summarize(results);
      const message = speakable(label, okCount, total);
      return reply(req, res, 200, {
        ok: results.every((result) => result.ok),
        message,
        results
      }, message);
    } catch (err) {
      if (err instanceof GroupNotFoundError) {
        return reply(req, res, 404, { error: err.message }, err.message);
      }
      throw err;
    }
  });

  return router;
}

type Named = { id: string; name: string };
type ResolveError = { status: 400 | 404; error: string };

function isResolveError<T extends Named>(value: T | ResolveError): value is ResolveError {
  return !('id' in value);
}

/** Exact id first, otherwise one trimmed case-insensitive name match. */
function resolveNamed<T extends Named>(items: T[], query: string, noun: string): T | ResolveError {
  const byId = items.find((item) => item.id === query);
  if (byId) return byId;
  const wanted = query.trim().toLowerCase();
  const matches = items.filter((item) => item.name.trim().toLowerCase() === wanted);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) return { status: 404, error: `Unknown ${noun} "${query}"` };
  return { status: 400, error: `Ambiguous ${noun} name "${query}" (${matches.length} matches)` };
}

/** Distinct controllers, and how many of them had every target succeed. */
function summarize(results: ApplyResult[]): { okCount: number; total: number } {
  const okByController = new Map<string, boolean>();
  for (const result of results) {
    const soFar = okByController.get(result.controllerId) ?? true;
    okByController.set(result.controllerId, soFar && result.ok);
  }
  let okCount = 0;
  for (const ok of okByController.values()) if (ok) okCount += 1;
  return { okCount, total: okByController.size };
}

/** "LSU Wipe on 2 controllers", or "LSU Wipe on 1 of 2 controllers" when some failed. */
function speakable(label: string, okCount: number, total: number): string {
  const noun = total === 1 ? 'controller' : 'controllers';
  if (okCount === total) return `${label} on ${total} ${noun}`;
  return `${label} on ${okCount} of ${total} ${noun}`;
}

function wantsText(req: Request): boolean {
  const format = req.query.format;
  const values = Array.isArray(format) ? format : format === undefined ? [] : [format];
  if (values.some((value) => String(value).toLowerCase() === 'text')) return true;
  const accept = req.get('accept');
  if (!accept) return false;
  return accept.split(',').some((part) => part.split(';')[0]?.trim().toLowerCase() === 'text/plain');
}

function reply(req: Request, res: Response, status: number, body: unknown, text: string): void {
  if (wantsText(req)) {
    res.status(status).type('text/plain').send(text);
    return;
  }
  res.status(status).json(body);
}
