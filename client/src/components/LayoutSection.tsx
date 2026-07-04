import { useEffect, useState } from 'react';
import {
  listStrips, addStrip, listControllers, listThemes, applyControl,
  type Strip, type Controller, type CustomTheme, type ControlAction
} from '../api/client';
import { StripCanvas } from './StripCanvas';
import { StripPathEditor } from './StripPathEditor';
import { ControlPanel } from './ControlPanel';

export function LayoutSection() {
  const [strips, setStrips] = useState<Strip[]>([]);
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    listStrips().then(setStrips);
    listControllers().then(setControllers);
    listThemes().then(setThemes);
  }, []);

  const staleControllerIds = new Set(controllers.filter((c) => c.stale).map((c) => c.id));

  async function handleComplete(input: { controllerId: string; wledSegId: number; points: { x: number; y: number }[]; label: string | null }) {
    const { strip } = await addStrip(input);
    setStrips((prev) => [...prev, strip]);
    setDrawing(false);
  }

  const selectedMembers = strips.filter((s) => selected.has(s.id)).map((s) => ({ controllerId: s.controllerId, wledSegId: s.wledSegId }));

  async function handleApply(action: ControlAction) {
    await applyControl(selectedMembers, action);
  }

  return (
    <section className="section layout-section">
      <div className="layout-toolbar">
        <h2>Layout</h2>
        <div className="layout-toolbar-actions">
          <span className="controller-meta">{selected.size} selected</span>
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
            <StripCanvas
              strips={strips}
              selected={selected}
              staleControllerIds={staleControllerIds}
              onSelectionChange={setSelected}
            />
          )}
        </div>
        <ControlPanel selectedMembers={selectedMembers} themes={themes} onApply={handleApply} />
      </div>
    </section>
  );
}
