import { getInfo } from '../wled/client.js';
import { assertValidHost } from '../controllers/validateHost.js';

export type OtaUpdateResult =
  | { ok: true; installedVersion: string }
  | { ok: false; error: string };

const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Uploads a firmware asset to a WLED device's manual OTA endpoint and polls
 * for the device to come back on the expected version.
 *
 * NOTE ON THE MULTIPART FIELD NAME: WLED's `/update` endpoint (the same one
 * its own web UI's "Manual OTA Update" page posts to) expects the firmware
 * binary under a specific multipart form field name. As of the WLED 0.14/0.15
 * release cycle this has historically been documented as `firmware`, but per
 * the firmware design spec this MUST be verified against the actual WLED
 * source (`wled00/data/update.htm` / `wled00/set.cpp`) or a real device
 * before this code is considered complete — see Step 4 below. Do not change
 * the OTA-push retry/non-retry semantics below when that verification
 * happens; only the literal field name string may need to change.
 */
const OTA_UPLOAD_FIELD_NAME = 'firmware';

export async function pushOtaUpdate(
  host: string,
  assetBytes: ArrayBuffer,
  expectedTag: string,
  opts: { maxRetries?: number; retryDelayMs?: number } = {}
): Promise<OtaUpdateResult> {
  assertValidHost(host);

  const form = new FormData();
  form.append(OTA_UPLOAD_FIELD_NAME, new Blob([assetBytes]), 'firmware.bin');

  let uploadRes: Response;
  try {
    uploadRes = await fetch(`http://${host}/update`, { method: 'POST', body: form });
  } catch (err: any) {
    // Upload failure is surfaced immediately — never retried, since a failed
    // OTA mid-flash is a bricking risk, not just a transient error.
    return { ok: false, error: `upload failed: ${err.message}` };
  }
  if (!uploadRes.ok) {
    return { ok: false, error: `upload failed: device responded ${uploadRes.status}` };
  }

  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const expectedVersion = expectedTag.startsWith('v') ? expectedTag.slice(1) : expectedTag;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await sleep(retryDelayMs);
    try {
      const info = await getInfo(host);
      if (info.ver === expectedVersion) {
        return { ok: true, installedVersion: info.ver };
      }
      // Device is back but reporting a different version than expected —
      // no point continuing to retry, this needs manual verification.
      return { ok: false, error: `version mismatch after update: expected ${expectedVersion}, device reports ${info.ver}` };
    } catch {
      // Still rebooting/unreachable — keep polling within the retry budget.
      continue;
    }
  }

  return { ok: false, error: `device did not come back within the retry budget (${maxRetries} attempts)` };
}
