#!/usr/bin/env node
// Reversible real-hardware smoke test for uber-wled releases.
//
//   node scripts/hw-smoke.mjs [deviceHost] [apiBase]
//     deviceHost  WLED controller host    (default 192.168.1.86)
//     apiBase     uber-wled server base   (default http://localhost:3000)
//
// THIS IS THE ONLY PERMITTED REAL-DEVICE WRITE PATH. Run it MANUALLY as the
// release orchestrator; never wire it into vitest/CI. Flow:
//   1. capture  GET  http://<device>/json/state          (exact snapshot)
//   2. apply    POST <apiBase>/api/control/apply         (v2 targets+patch:
//               orange + effect "Blink" through uber-wled itself)
//   3. verify   GET  http://<device>/json/state          (color + fx took)
//   4. restore  POST http://<device>/json/state          (snapshot, exact)
//   5. verify   GET  http://<device>/json/state          (matches snapshot)

import { pathToFileURL } from 'node:url';

const SMOKE_COLOR = [255, 64, 0, 0]; // orange (w = 0)
const SMOKE_FX_NAME = 'Blink';
const SETTLE_MS = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
  return res.json();
}

/**
 * Builds the exact-restore /json/state patch from a captured state. Pure —
 * covered by the hardware-free check in the plan. Restores every field the
 * smoke could have disturbed (top-level power/brightness/transition and the
 * full per-segment look), always with udpn:{nn:true}.
 */
export function buildRestorePatch(state) {
  return {
    on: state.on,
    bri: state.bri,
    transition: state.transition,
    udpn: { nn: true },
    seg: state.seg.map((s) => ({
      id: s.id, on: s.on, bri: s.bri, frz: s.frz,
      fx: s.fx, sx: s.sx, ix: s.ix, pal: s.pal,
      c1: s.c1, c2: s.c2, c3: s.c3,
      o1: s.o1, o2: s.o2, o3: s.o3,
      cct: s.cct, rev: s.rev, mi: s.mi,
      col: s.col.map((c) => [...c])
    }))
  };
}

function assertEqual(actual, expected, label, failures) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function main() {
  const deviceHost = process.argv[2] ?? '192.168.1.86';
  const apiBase = process.argv[3] ?? 'http://localhost:3000';

  console.log(`[1/5] capture: http://${deviceHost}/json/state`);
  const before = await getJson(`http://${deviceHost}/json/state`);
  console.log(`      on=${before.on} bri=${before.bri} segs=${before.seg.length}`);

  const controllers = await getJson(`${apiBase}/api/controllers`);
  const controller = controllers.find((c) => c.host === deviceHost);
  if (!controller) throw new Error(`uber-wled at ${apiBase} has no controller with host ${deviceHost}`);

  const effects = await getJson(`http://${deviceHost}/json/eff`);
  const smokeFxId = effects.indexOf(SMOKE_FX_NAME);
  if (smokeFxId < 0) throw new Error(`device has no effect named ${SMOKE_FX_NAME}`);

  console.log(`[2/5] apply via uber-wled v2: color+${SMOKE_FX_NAME} -> controller ${controller.id}`);
  const applied = await postJson(`${apiBase}/api/control/apply`, {
    targets: [{ kind: 'controller', controllerId: controller.id }],
    patch: { on: true, seg: { fxName: SMOKE_FX_NAME, col: [SMOKE_COLOR] } }
  });
  const failedTargets = applied.results.filter((r) => !r.ok);
  if (failedTargets.length > 0) throw new Error(`apply failed: ${JSON.stringify(failedTargets)}`);

  await sleep(SETTLE_MS);
  console.log('[3/5] verify smoke state on device');
  const during = await getJson(`http://${deviceHost}/json/state`);
  const failures = [];
  assertEqual(during.seg[0].col[0].slice(0, 3), SMOKE_COLOR.slice(0, 3), 'seg0 color', failures);
  assertEqual(during.seg[0].fx, smokeFxId, 'seg0 fx', failures);
  if (failures.length > 0) {
    console.error('SMOKE APPLY DID NOT TAKE:\n  ' + failures.join('\n  '));
    // fall through to restore regardless — never leave the device dirty
  }

  console.log('[4/5] restore captured state (direct to device, udpn nn)');
  await postJson(`http://${deviceHost}/json/state`, buildRestorePatch(before));
  await sleep(SETTLE_MS);

  console.log('[5/5] verify restoration');
  const after = await getJson(`http://${deviceHost}/json/state`);
  const restoreFailures = [];
  assertEqual(after.on, before.on, 'on', restoreFailures);
  assertEqual(after.bri, before.bri, 'bri', restoreFailures);
  for (const [i, s] of before.seg.entries()) {
    const a = after.seg[i];
    for (const k of ['on', 'bri', 'fx', 'sx', 'ix', 'pal']) assertEqual(a?.[k], s[k], `seg${i}.${k}`, restoreFailures);
    assertEqual(a?.col, s.col, `seg${i}.col`, restoreFailures);
  }
  if (failures.length > 0 || restoreFailures.length > 0) {
    if (restoreFailures.length > 0) console.error('RESTORE MISMATCH:\n  ' + restoreFailures.join('\n  '));
    process.exit(1);
  }
  console.log('PASS: applied and fully restored. Device state is exactly as captured.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
