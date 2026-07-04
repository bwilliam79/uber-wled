export interface Point {
  x: number;
  y: number;
}

export interface SplitRecommendation {
  deviceSegId: number;
  suggestedSplitAt: number;
  reason: string;
}

function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

export function recommendSplits(
  placements: { wledSegId: number; points: Point[] }[],
  deviceSegments: { id: number; start: number; stop: number }[]
): SplitRecommendation[] {
  const recommendations: SplitRecommendation[] = [];
  const bySegId = new Map<number, typeof placements>();

  for (const placement of placements) {
    const group = bySegId.get(placement.wledSegId) ?? [];
    group.push(placement);
    bySegId.set(placement.wledSegId, group);
  }

  for (const [segId, group] of bySegId) {
    if (group.length < 2) continue;
    const device = deviceSegments.find((d) => d.id === segId);
    if (!device) continue;

    const deviceLen = device.stop - device.start;
    const totalDrawnLen = group.reduce((sum, p) => sum + pathLength(p.points), 0);
    let cursor = device.start;

    for (let i = 0; i < group.length - 1; i++) {
      const share = pathLength(group[i].points) / totalDrawnLen;
      cursor += Math.round(share * deviceLen);
      recommendations.push({
        deviceSegId: segId,
        suggestedSplitAt: cursor,
        reason: `Two placements are linked to device segment ${segId}; splitting it would let each be controlled independently.`
      });
    }
  }

  return recommendations;
}
