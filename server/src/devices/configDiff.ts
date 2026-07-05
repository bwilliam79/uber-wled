export interface ConfigDiffEntry {
  path: string;
  from: unknown;
  to: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function join(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key);
}

function walk(current: unknown, patch: unknown, path: string, out: ConfigDiffEntry[]): void {
  if (isPlainObject(patch)) {
    // Objects merge: only keys present in the patch are compared.
    const base = isPlainObject(current) ? current : undefined;
    for (const key of Object.keys(patch)) {
      walk(base?.[key], patch[key], join(path, key), out);
    }
    return;
  }
  if (Array.isArray(patch)) {
    // Arrays replace: compare index-by-index across the longer array.
    const base = Array.isArray(current) ? current : [];
    const max = Math.max(patch.length, base.length);
    for (let i = 0; i < max; i += 1) {
      if (i >= patch.length) {
        out.push({ path: join(path, i), from: base[i], to: undefined }); // removed by the patch
      } else {
        walk(base[i], patch[i], join(path, i), out);
      }
    }
    return;
  }
  // Scalar leaf (string/number/boolean/null).
  if (!Object.is(current, patch)) {
    out.push({ path, from: current, to: patch });
  }
}

export function buildConfigDiff(current: unknown, patch: unknown): ConfigDiffEntry[] {
  const out: ConfigDiffEntry[] = [];
  walk(current, patch, '', out);
  return out;
}

export function rebootRequired(diff: ConfigDiffEntry[]): boolean {
  return diff.some((entry) => /^(hw|nw|ap|eth)\./.test(entry.path));
}
