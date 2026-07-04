import { useState } from 'react';

export function SegmentPathEditor({
  onComplete
}: {
  onComplete: (points: { x: number; y: number }[]) => void;
}) {
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPoints((prev) => [...prev, { x, y }]);
  }

  function finish() {
    if (points.length >= 2) onComplete(points);
    setPoints([]);
  }

  return (
    <div className="segment-path-editor">
      <svg viewBox="0 0 100 100" className="segment-path-editor-canvas" onClick={handleClick}>
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="#a3ff5e"
          strokeWidth={2}
        />
      </svg>
      <button type="button" className="btn btn-primary" onClick={finish} disabled={points.length < 2}>
        Finish segment ({points.length} points)
      </button>
    </div>
  );
}
