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
 * NOTE ON THE MULTIPART FIELD NAME: verified directly against a real
 * device's /update page source (WLED 16.0.0) — its upload form is
 * `<input type=file name=update required>`, so the field name is `update`,
 * not `firmware`.
 *
 * NOTE ON WLED's server-side compatibility check: ota_update.cpp
 * (validateOTA/shouldAllowOTA) independently compares the uploaded binary's
 * embedded release_name against the device's own currently-running
 * release_name, and 500s on a mismatch ("Firmware release name mismatch:
 * current=..., uploaded=..."). This is a real, usually-correct anti-bricking
 * check (it succeeds for ordinary same-variant updates), not something to
 * blanket-bypass via the "skipValidation" field WLED's own OTA page exposes
 * for this — see the discussion in the firmware design work around
 * 2026-07-08 for why. If this starts showing up as the actual cause via the
 * captured error text below, the real fix is matching the asset to the
 * board's specific release variant more precisely, not disabling the check.
 */
const OTA_UPLOAD_FIELD_NAME = 'update';

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
    // WLED's error responses carry the actual reason in the body (e.g. the
    // specific compatibility-check failure text) — surface it instead of
    // just the bare status code.
    const body = await uploadRes.text().catch(() => '');
    const detail = body.trim() ? `: ${body.trim()}` : '';
    return { ok: false, error: `upload failed: device responded ${uploadRes.status}${detail}` };
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
