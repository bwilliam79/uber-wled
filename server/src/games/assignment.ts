/**
 * A game trigger assignment is either one theme id (whole controller) or both
 * halves of a split-night strip. Stored JSON stays an object keyed by
 * controller id, so rows that only contain theme id strings still parse.
 */
export interface SplitAssignment {
  lsu: string;
  ark: string;
}

export type GameAssignment = string | SplitAssignment;

export function isSplitAssignment(value: GameAssignment): value is SplitAssignment {
  return typeof value !== 'string';
}

export function parseAssignmentValue(value: unknown): GameAssignment | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const lsu = (value as { lsu?: unknown }).lsu;
  const ark = (value as { ark?: unknown }).ark;
  if (typeof lsu !== 'string' || lsu.length === 0) return undefined;
  if (typeof ark !== 'string' || ark.length === 0) return undefined;
  return { lsu, ark };
}

export function parseAssignments(raw: string): Record<string, GameAssignment> {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, GameAssignment> = {};
    for (const [controllerId, entry] of Object.entries(value as Record<string, unknown>)) {
      const parsed = parseAssignmentValue(entry);
      if (parsed) out[controllerId] = parsed;
    }
    return out;
  } catch {
    return {};
  }
}

export function cloneAssignments(assignments: Record<string, GameAssignment>): Record<string, GameAssignment> {
  const out: Record<string, GameAssignment> = {};
  for (const [controllerId, value] of Object.entries(assignments)) {
    out[controllerId] = typeof value === 'string' ? value : { lsu: value.lsu, ark: value.ark };
  }
  return out;
}
