import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createThemesRouter } from '../../src/themes/routes.js';
import {
  createThemeRepository, validateDirections, parseDirections, directionsToSegRev
} from '../../src/themes/repository.js';
import { actionToPatch, applyActionV2 } from '../../src/control/actionMap.js';
import { applyControlPatch } from '../../src/control/applyV2.js';
import { buildThemesExport, importThemes, buildBackup, restoreBackup } from '../../src/backup/service.js';

type Db = ReturnType<typeof createDb>;

/** Captures every POST body per host; GET /json/state returns two segments. */
function stubDevices() {
  const posts: Record<string, any[]> = {};
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const host = new URL(url).host;
    if (init?.method === 'POST') {
      (posts[host] ??= []).push(JSON.parse(init.body as string));
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
    }
    return {
      ok: true, status: 200,
      json: async () => ({ on: true, bri: 100, ps: -1, seg: [{ id: 0 }, { id: 1 }] })
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return posts;
}

const BASE = { name: 'Arkansas Scanner', effect: 10, palette: 0, brightness: 140, speed: 235, intensity: 120,
  colors: [[255, 255, 255, 0], [200, 0, 25, 0], [0, 0, 0, 0]] };

function setup() {
  const db = createDb(':memory:');
  const controllers = createControllerRepository(db);
  const left = controllers.add({ name: 'fp-left', host: '10.0.0.35', source: 'manual' }).id;
  const right = controllers.add({ name: 'fp-right', host: '10.0.0.130', source: 'manual' }).id;
  const other = controllers.add({ name: 'tv', host: '10.0.0.40', source: 'manual' }).id;
  return { db, left, right, other };
}

afterEach(() => vi.unstubAllGlobals());

describe('validateDirections / parseDirections', () => {
  it('accepts a controller-keyed rev map and normalises empty to null', () => {
    expect(validateDirections({ a: { rev: true }, b: { rev: false } }))
      .toEqual({ directions: { a: { rev: true }, b: { rev: false } } });
    expect(validateDirections({})).toEqual({ directions: null });
    expect(validateDirections(null)).toEqual({ directions: null });
    expect(validateDirections(undefined)).toEqual({ directions: null });
  });

  it('rejects non-boolean rev, arrays and non-objects', () => {
    expect(validateDirections({ a: { rev: 'yes' } })).toHaveProperty('error');
    expect(validateDirections({ a: true })).toHaveProperty('error');
    expect(validateDirections([])).toHaveProperty('error');
    expect(validateDirections('x')).toHaveProperty('error');
  });

  it('parses stored JSON and degrades malformed values to null', () => {
    expect(parseDirections('{"a":{"rev":true}}')).toEqual({ a: { rev: true } });
    expect(parseDirections('not json')).toBeNull();
    expect(parseDirections('{"a":{"rev":1}}')).toBeNull();
    expect(parseDirections(null)).toBeNull();
  });

  it('maps to a segRev patch only when there are entries', () => {
    expect(directionsToSegRev(null)).toBeUndefined();
    expect(directionsToSegRev({ a: { rev: false }, b: { rev: true } })).toEqual({ a: false, b: true });
  });
});

describe('migration', () => {
  it('adds a nullable directions column idempotently, leaving existing rows untouched', () => {
    // createDb on a path runs the schema; use a temp file to exercise ALTER on an old table.
    const tmp = `/tmp/uw-dir-${process.pid}-${Date.now()}.db`;
    const old = new Database(tmp);
    old.exec(`CREATE TABLE themes (id TEXT PRIMARY KEY, name TEXT NOT NULL, effect INTEGER NOT NULL,
      palette INTEGER NOT NULL, colors TEXT NOT NULL, brightness INTEGER NOT NULL,
      speed INTEGER NOT NULL DEFAULT 128, intensity INTEGER NOT NULL DEFAULT 128)`);
    old.prepare(`INSERT INTO themes VALUES ('t1','Old',1,0,'[[1,2,3]]',100,200,90)`).run();
    old.close();
    const db1 = createDb(tmp); db1.close();
    const db = createDb(tmp); // second run must be a no-op
    const cols = (db.prepare('PRAGMA table_info(themes)').all() as { name: string; notnull: number }[]);
    expect(cols.filter((c) => c.name === 'directions')).toEqual([expect.objectContaining({ notnull: 0 })]);
    expect(createThemeRepository(db).get('t1')).toEqual({
      id: 't1', name: 'Old', effect: 1, palette: 0, colors: [[1, 2, 3]], brightness: 100,
      speed: 200, intensity: 90, directions: null
    });
    db.close();
    rmSync(tmp, { force: true });
  });
});

describe('theme repository + routes', () => {
  let db: Db; let app: express.Express; let left: string; let right: string;
  beforeEach(() => {
    ({ db, left, right } = setup());
    app = express();
    app.use(express.json());
    app.use('/api/themes', createThemesRouter(db));
  });

  it('round-trips directions through POST/GET', async () => {
    const post = await request(app).post('/api/themes')
      .send({ ...BASE, directions: { [left]: { rev: false }, [right]: { rev: true } } });
    expect(post.status).toBe(201);
    const list = await request(app).get('/api/themes');
    expect(list.body[0].directions).toEqual({ [left]: { rev: false }, [right]: { rev: true } });
  });

  it('defaults to null when omitted', async () => {
    const post = await request(app).post('/api/themes').send(BASE);
    expect(post.body.directions).toBeNull();
  });

  it('rejects an invalid directions value with 400 and stores nothing', async () => {
    const res = await request(app).post('/api/themes').send({ ...BASE, directions: { [left]: { rev: 'true' } } });
    expect(res.status).toBe(400);
    expect((await request(app).get('/api/themes')).body).toEqual([]);
  });

  it('PUT sets, keeps (when omitted) and clears (null) directions without touching other fields', async () => {
    const { body: t } = await request(app).post('/api/themes').send(BASE);
    const set = await request(app).put(`/api/themes/${t.id}`)
      .send({ ...BASE, directions: { [right]: { rev: true } } });
    expect(set.body).toEqual({ ...BASE, id: t.id, directions: { [right]: { rev: true } } });
    const kept = await request(app).put(`/api/themes/${t.id}`).send({ ...BASE, name: 'Renamed' });
    expect(kept.body.directions).toEqual({ [right]: { rev: true } });
    expect(kept.body.name).toBe('Renamed');
    const cleared = await request(app).put(`/api/themes/${t.id}`).send({ ...BASE, directions: null });
    expect(cleared.body.directions).toBeNull();
    const bad = await request(app).put(`/api/themes/${t.id}`).send({ ...BASE, directions: { [right]: {} } });
    expect(bad.status).toBe(400);
  });
});

describe('apply payload', () => {
  it('actionToPatch includes segRev only when the theme has directions', () => {
    const t = { effect: 10, palette: 0, colors: [[1, 2, 3]], brightness: 140, speed: 235, intensity: 120 };
    expect(actionToPatch({ type: 'theme', themeId: 'x' }, () => t)).not.toHaveProperty('segRev');
    expect(actionToPatch({ type: 'theme', themeId: 'x' }, () => ({ ...t, directions: null }))).not.toHaveProperty('segRev');
    expect(actionToPatch({ type: 'theme', themeId: 'x' }, () => ({ ...t, directions: { a: { rev: true } } })))
      .toEqual(expect.objectContaining({ segRev: { a: true } }));
  });

  it('sends rev only to controllers with an entry, on the same segments as the colors', async () => {
    const { db, left, right, other } = setup();
    const posts = stubDevices();
    const theme = createThemeRepository(db).add({ ...BASE, directions: { [left]: { rev: false }, [right]: { rev: true } } });
    await applyActionV2(db, [
      { controllerId: left, wledSegId: null },
      { controllerId: right, wledSegId: 1 },
      { controllerId: other, wledSegId: null }
    ], { type: 'theme', themeId: theme.id });

    const seg = { fx: 10, pal: 0, col: BASE.colors, sx: 235, ix: 120 };
    expect(posts['10.0.0.35'][0].seg).toEqual([{ id: 0, ...seg, rev: false }, { id: 1, ...seg, rev: false }]);
    expect(posts['10.0.0.130'][0].seg).toEqual([{ id: 1, ...seg, rev: true }]);
    expect(posts['10.0.0.40'][0].seg).toEqual([{ id: 0, ...seg }, { id: 1, ...seg }]);
    expect(posts['10.0.0.40'][0].seg[0]).not.toHaveProperty('rev');
  });

  it('a theme without directions never sends rev (unchanged behaviour)', async () => {
    const { db, left } = setup();
    const posts = stubDevices();
    const theme = createThemeRepository(db).add(BASE);
    await applyActionV2(db, [{ controllerId: left, wledSegId: null }], { type: 'theme', themeId: theme.id });
    for (const s of posts['10.0.0.35'][0].seg) expect(s).not.toHaveProperty('rev');
  });

  it('applyControlPatch honours segRev through group targets (client/Control path)', async () => {
    const { db, left, right } = setup();
    const posts = stubDevices();
    const group = createGroupRepository(db).add({
      name: 'Shelves', members: [{ controllerId: left, wledSegId: 0 }, { controllerId: right, wledSegId: 0 }]
    });
    await applyControlPatch(db, [{ kind: 'group', groupId: group.id }],
      { bri: 140, seg: { fxId: 10 }, segRev: { [right]: true } });
    expect(posts['10.0.0.35'][0].seg).toEqual([{ id: 0, fx: 10 }]);
    expect(posts['10.0.0.130'][0].seg).toEqual([{ id: 0, fx: 10, rev: true }]);
  });

  it('a plain seg.rev (snapshot revert) is passed through', async () => {
    const { db, left } = setup();
    const posts = stubDevices();
    await applyControlPatch(db, [{ kind: 'segment', controllerId: left, wledSegId: 0 }], { seg: { rev: true } });
    expect(posts['10.0.0.35'][0].seg).toEqual([{ id: 0, rev: true }]);
  });
});

describe('backup round-trip', () => {
  it('themes export/import keeps directions and sanitises malformed ones', () => {
    const { db, left, right } = setup();
    const repo = createThemeRepository(db);
    repo.add({ ...BASE, directions: { [left]: { rev: false }, [right]: { rev: true } } });
    const exported = buildThemesExport(db, 'now');
    const target = setup().db;
    const bad = { ...exported, themes: [...exported.themes, { ...exported.themes[0], name: 'Bad', directions: '{"x":{"rev":"no"}}' }] };
    expect(importThemes(target, bad)).toEqual({ imported: 2 });
    const byName = Object.fromEntries(createThemeRepository(target).list().map((t) => [t.name, t]));
    expect(byName['Arkansas Scanner'].directions).toEqual({ [left]: { rev: false }, [right]: { rev: true } });
    expect(byName['Bad'].directions).toBeNull();
  });

  it('imports an older export with no directions field', () => {
    const { db } = setup();
    const legacy = { kind: 'uber-wled-themes', version: 1, exportedAt: 'x',
      themes: [{ id: 'old', name: 'Legacy', effect: 1, palette: 0, colors: '[[1,2,3]]', brightness: 9, speed: 128, intensity: 128 }] };
    importThemes(db, legacy);
    expect(createThemeRepository(db).list()[0].directions).toBeNull();
  });

  it('full backup/restore preserves directions', () => {
    const { db, left, right } = setup();
    const t = createThemeRepository(db).add({ ...BASE, directions: { [left]: { rev: false }, [right]: { rev: true } } });
    const backup = JSON.parse(JSON.stringify(buildBackup(db, 'now')));
    const target = createDb(':memory:');
    restoreBackup(target, backup);
    expect(createThemeRepository(target).get(t.id)).toEqual(t);
  });
});
