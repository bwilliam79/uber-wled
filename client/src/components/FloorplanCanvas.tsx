import type { Floorplan, Placement } from '../api/client';

export function FloorplanCanvas({
  floorplan,
  placements,
  selected,
  onToggleSelect
}: {
  floorplan: Floorplan;
  placements: Placement[];
  selected: Set<string>;
  onToggleSelect: (placementId: string) => void;
}) {
  return (
    <svg viewBox="0 0 100 100" className="floorplan-canvas">
      <image href={floorplan.imagePath} x={0} y={0} width={100} height={100} />
      {placements.map((p) => (
        <polyline
          key={p.id}
          data-testid={`placement-${p.id}`}
          data-selected={selected.has(p.id) ? 'true' : 'false'}
          points={p.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
          fill="none"
          stroke={selected.has(p.id) ? '#ff5ec8' : '#5ee1ff'}
          strokeWidth={selected.has(p.id) ? 3 : 2}
          onClick={() => onToggleSelect(p.id)}
        />
      ))}
    </svg>
  );
}
