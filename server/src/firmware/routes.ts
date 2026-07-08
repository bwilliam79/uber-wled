import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { getInfo } from '../wled/client.js';
import { fetchLatestRelease, type ReleaseAsset } from './githubClient.js';
import { candidateAssets, recommendedAssetName, resolvePinnedAsset } from './assetMatch.js';
import { pushOtaUpdate } from './otaPush.js';
import { createSettingsRepository } from '../settings/repository.js';

export function createFirmwareRouter(db: Database.Database): Router {
  const router = Router({ mergeParams: true });
  const controllers = createControllerRepository(db);
  const settings = createSettingsRepository(db);

  router.get<{ id: string }>('/', async (req, res) => {
    const controller = controllers.list().find((c) => c.id === req.params.id);
    if (!controller) return res.status(404).json({ error: 'controller not found' });

    const includePrerelease = settings.get().includePrereleaseFirmware;

    let info;
    try {
      info = await getInfo(controller.host);
    } catch {
      // Controller is unreachable (offline/stale). Respond with an offline
      // status instead of leaving the request hanging (Express 4 does not
      // catch async rejections, so an unhandled throw here never responds).
      return res.json({
        unreachable: true,
        installedVersion: null,
        latestTag: null,
        updateAvailable: false,
        isPrerelease: false,
        pinnedAssetPattern: controller.pinnedAssetPattern,
        candidateAssets: [],
        detectedArch: null
      });
    }

    let release;
    try {
      release = await fetchLatestRelease(db, { includePrerelease });
    } catch {
      // GitHub unreachable and no cached releases — report the installed
      // version only, without an available-update comparison.
      return res.json({
        installedVersion: info.ver,
        latestTag: null,
        updateAvailable: false,
        isPrerelease: false,
        pinnedAssetPattern: controller.pinnedAssetPattern,
        candidateAssets: [],
        detectedArch: info.arch
      });
    }

    // Always compute the candidate list, whether or not a pattern is already
    // pinned: the client uses it both for the first-time picker and for the
    // "override firmware asset" flow once a pin already exists, so this data
    // must stay available across the pin's whole lifecycle, not just before
    // the first pin.
    const assets: ReleaseAsset[] = candidateAssets(release, info.arch);

    const normalizedInstalled = info.ver.startsWith('v') ? info.ver : `v${info.ver}`;

    res.json({
      installedVersion: info.ver,
      latestTag: release.tag,
      updateAvailable: normalizedInstalled !== release.tag,
      isPrerelease: release.prerelease,
      pinnedAssetPattern: controller.pinnedAssetPattern,
      candidateAssets: assets,
      recommendedAssetName: recommendedAssetName(assets, info.arch),
      detectedArch: info.arch
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

    const release = await fetchLatestRelease(db, { includePrerelease: settings.get().includePrereleaseFirmware });
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
