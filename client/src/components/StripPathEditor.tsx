import { useState } from 'react';
import type { Controller } from '../api/client';

export function StripPathEditor({
  controllers,
  onComplete,
  onCancel
}: {
  controllers: Controller[];
  onComplete: (input: { controllerId: string; wledSegId: number; points: { x: number; y: number }[]; label: string | null }) => void;
  onCancel: () => void;
}) {
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [controllerId, setControllerId] = useState(controllers[0]?.id ?? '');
  const [wledSegId, setWledSegId] = useState(0);
  const [label, setLabel] = useState('');

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPoints((prev) => [...prev, { x, y }]);
  }

  function finish() {
    if (points.length < 2 || !controllerId) return;
    onComplete({ controllerId, wledSegId, points, label: label || null });
  }

  return (
    <div className="strip-draw">
      <svg viewBox="0 0 100 100" className="strip-canvas draw" data-testid="draw-canvas" preserveAspectRatio="none" onClick={handleClick}>
        <polyline points={points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#a3ff5e" strokeWidth={1.6} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.2} fill="#a3ff5e" />
        ))}
      </svg>
      <div className="add-controller-form">
        <div className="field">
          <label htmlFor="strip-controller">Controller</label>
          <select id="strip-controller" className="input" value={controllerId} onChange={(e) => setControllerId(e.target.value)}>
            {controllers.length === 0 && <option value="">No controllers</option>}
            {controllers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="strip-seg">Segment ID</label>
          <input id="strip-seg" aria-label="segment id" className="input" type="number" min={0} value={wledSegId} onChange={(e) => setWledSegId(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="strip-label">Label (optional)</label>
          <input id="strip-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Porch rail" />
        </div>
        <button type="button" className="btn btn-primary" onClick={finish} disabled={points.length < 2 || !controllerId}>
          Finish strip ({points.length} points)
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
