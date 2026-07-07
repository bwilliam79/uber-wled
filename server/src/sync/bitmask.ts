/**
 * WLED's native UDP sync (broadcast on LAN port 21324) supports up to 8
 * independent "groups" via a single-byte bitmask on each device's
 * `if.sync.send.grp` / `if.sync.recv.grp` config — one bit per group. A
 * device only accepts a sync broadcast from another device if their recv
 * and the sender's send bitmasks share at least one set bit.
 *
 * This app's sync groups each own exactly one of those 8 bits while active,
 * so two active sync groups never cross-talk. Confirmed live against a real
 * device (192.168.1.86, WLED 16.0.0): POST /json/cfg with
 * {"if":{"sync":{"recv":{"grp":<n>}}}} patches just that field, applies
 * immediately, no reboot required (interface/sync config isn't in the
 * hw./nw./ap./eth. prefixes this app's own configDiff.ts flags as
 * reboot-requiring).
 */
export const SYNC_BITS = [1, 2, 4, 8, 16, 32, 64, 128] as const;
export const MAX_SYNC_GROUPS = SYNC_BITS.length;

export class NoFreeSyncBitError extends Error {
  constructor() {
    super(`no free sync group slot (max ${MAX_SYNC_GROUPS} concurrent active sync groups)`);
    this.name = 'NoFreeSyncBitError';
  }
}

/** Lowest bit not already in `usedBits`. Throws if all 8 are taken. */
export function allocateBit(usedBits: readonly number[]): number {
  const used = new Set(usedBits);
  const bit = SYNC_BITS.find((b) => !used.has(b));
  if (bit === undefined) throw new NoFreeSyncBitError();
  return bit;
}
