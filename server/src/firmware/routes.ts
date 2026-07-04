import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { getInfo } from '../wled/client.js';
import { fetchLatestRelease, type ReleaseAsset } from './githubClient.js';
import { candidateAssets, resolvePinnedAsset } from './assetMatch.js';
import { pushOtaUpdate } from './otaPush.js';

export function createFirmwareRouter(db: Database.Database): Router {
  const router = Router({ mergeParams: true });
  const controllers = createControllerRepository(db);

  router.get<{ id: string }>('/', async (req, res) => {
    const controller = controllers.list().find((c) => c.id === req.params.id);
    if (!controller) return res.status(404).json({ error: 'controller not found' });

    const [info, release] = await Promise.all([getInfo(controller.host), fetchLatestRelease(db)]);

    let assets: ReleaseAsset[] = [];
    if (!controller.pinnedAssetPattern) {
      assets = candidateAssets(release, info.arch);
    } else {
      const resolved = resolvePinnedAsset(release, controller.pinnedAssetPattern);
      if (!resolved) assets = candidateAssets(release, info.arch);
    }

    const normalizedInstalled = info.ver.startsWith('v') ? info.ver : `v${info.ver}`;

    res.json({
      installedVersion: info.ver,
      latestTag: release.tag,
      updateAvailable: normalizedInstalled !== release.tag,
      pinnedAssetPattern: controller.pinnedAssetPattern,
      candidateAssets: assets
    });
  });

  router.post<{ id: string }>('/pin', (req, res) => {
    const controller = controllers.list().find((c) => c.id === req.params.id);
    if (!controller) return res.status(404).json({ error: 'controller not found' });
    controllers.setPinnedAssetPattern(controller.id, req.body.assetPattern);
    res.status(204).end();
  });

  router.post<{ id: string }>('/update', async (req, res) => {
    const controller = controllers.list().find((c) => c.id === req.params.id);
    if (!controller) return res.status(404).json({ error: 'controller not found' });
    if (!controller.pinnedAssetPattern) {
      return res.status(400).json({ error: 'no asset pinned for this controller yet' });
    }

    const release = await fetchLatestRelease(db);
    const asset = resolvePinnedAsset(release, controller.pinnedAssetPattern);
    if (!asset) {
      return res.status(409).json({ error: 'pinned asset pattern no longer matches any asset in the latest release' });
    }

    let assetBytes: ArrayBuffer;
    try {
      const assetRes = await fetch(asset.downloadUrl);
      if (!assetRes.ok) throw new Error(`download failed: ${assetRes.status}`);
      assetBytes = await assetRes.arrayBuffer();
    } catch (err: any) {
      return res.status(502).json({ ok: false, error: `download failed: ${err.message}` });
    }

    const result = await pushOtaUpdate(controller.host, assetBytes, release.tag);
    res.json(result);
  });

  return router;
}
