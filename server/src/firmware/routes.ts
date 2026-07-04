import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { getInfo } from '../wled/client.js';
import { fetchLatestRelease, type ReleaseAsset } from './githubClient.js';
import { candidateAssets, resolvePinnedAsset } from './assetMatch.js';

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

  return router;
}
