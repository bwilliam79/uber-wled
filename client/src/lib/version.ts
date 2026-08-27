/** Compares dotted numeric versions (e.g. "1.5.3"); no pre-release suffixes.
 *  Keep in sync with server/src/appUpdate/routes.ts `isNewerVersion`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
