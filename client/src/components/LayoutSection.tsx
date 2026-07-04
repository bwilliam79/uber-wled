import { useCallback, useEffect, useState } from 'react';
import {
  listStrips, addStrip, listControllers, listThemes, applyControl, getSegmentsSnapshot,
  type Strip, type Controller, type CustomTheme, type ControlAction
} from '../api/client';
import { listRoomLabels, addRoomLabel, updateRoomLabel, type RoomLabel } from '../api/client';
import { segmentToCssColor } from '../lib/segmentColor';
import { StripCanvas } from './StripCanvas';
import { StripPathEditor } from './StripPathEditor';
import { ControlPanel } from './ControlPanel';
import { RoomLabelLayer } from './RoomLabelLayer';

export function LayoutSection() {
  const [strips, setStrips] = useState<Strip[]>([]);
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawing, setDrawing] = useState(false);
  const [labels, setLabels] = useState<RoomLabel[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [liveColors, setLiveColors] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    listStrips().then(setStrips);
    listControllers().then(setControllers);
    listThemes().then(setThemes);
    listRoomLabels().then(setLabels);
  }, []);

  const refreshLiveColors = useCallback(async () => {
    const controllerIds = Array.from(new Set(strips.map((s) => s.controllerId)));
    const next = new Map<string, string>();
    await Promise.all(
      controllerIds.map(async (cid) => {
        try {
          const segs = await getSegmentsSnapshot(cid);
          for (const s of strips.filter((st) => st.controllerId === cid)) {
            const seg = segs.find((sg) => sg.id === s.wledSegId);
            if (seg) next.set(s.id, segmentToCssColor(seg));
          }
        } catch {
          /* unreachable controller: leave its strips to the stale/greyed path */
        }
      })
    );
    setLiveColors(next);
  }, [strips]);

  useEffect(() => {
    refreshLiveColors();
    const t = setInterval(refreshLiveColors, 5000);
    return () => clearInterval(t);
  }, [refreshLiveColors]);

  const staleControllerIds = new Set(controllers.filter((c) => c.stale).map((c) => c.id));

  async function handleComplete(input: { controllerId: string; wledSegId: number; points: { x: number; y: number }[]; label: string | null }) {
    const { strip } = await addStrip(input);
    setStrips((prev) => [...prev, strip]);
    setDrawing(false);
  }

  const selectedMembers = strips.filter((s) => selected.has(s.id)).map((s) => ({ controllerId: s.controllerId, wledSegId: s.wledSegId }));

  async function handleApply(action: ControlAction) {
    await applyControl(selectedMembers, action);
    refreshLiveColors();
  }

  async function handleAddLabel() {
    if (!newLabel) return;
    const created = await addRoomLabel({ name: newLabel, x: 50, y: 50 });
    setLabels((prev) => [...prev, created]);
    setNewLabel('');
  }

  async function handleMoveLabel(id: string, x: number, y: number) {
    const updated = await updateRoomLabel(id, { x, y });
    setLabels((prev) => prev.map((l) => (l.id === id ? updated : l)));
  }

  return (
    <section className="section layout-section">
      <div className="layout-toolbar">
        <h2>Layout</h2>
        <div className="layout-toolbar-actions">
          <span className="controller-meta">{selected.size} selected</span>
          <input aria-label="new room label" className="input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Room label" />
          <button type="button" className="btn btn-secondary" onClick={handleAddLabel} disabled={!newLabel}>Add label</button>
          {!drawing && (
            <button type="button" className="btn btn-primary" onClick={() => setDrawing(true)} disabled={controllers.length === 0}>
              Draw strip
            </button>
          )}
        </div>
      </div>
      <div className="layout-body">
        <div className="layout-canvas-wrap">
          {drawing ? (
            <StripPathEditor controllers={controllers} onComplete={handleComplete} onCancel={() => setDrawing(false)} />
          ) : (
            <>
              <StripCanvas
                strips={strips}
                selected={selected}
                staleControllerIds={staleControllerIds}
                onSelectionChange={setSelected}
                liveColors={liveColors}
              >
                <RoomLabelLayer labels={labels} onMove={handleMoveLabel} />
              </StripCanvas>
              {strips.length === 0 && (
                <p className="layout-canvas-hint">
                  {controllers.length === 0
                    ? 'Add a controller in Controllers, then come back here to draw your first strip.'
                    : 'Click "Draw strip" above to trace your first LED strip onto the canvas.'}
                </p>
              )}
            </>
          )}
        </div>
        <ControlPanel selectedMembers={selectedMembers} themes={themes} onApply={handleApply} />
      </div>
    </section>
  );
}
