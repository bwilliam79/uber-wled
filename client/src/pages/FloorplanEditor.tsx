import { useEffect, useState } from 'react';
import {
  listFloorplans, listPlacements, addPlacement, listThemes, listControllers, applyControl,
  type Floorplan, type Placement, type CustomTheme, type Controller, type ControlAction
} from '../api/client';
import { FloorplanCanvas } from '../components/FloorplanCanvas';
import { SegmentPathEditor } from '../components/SegmentPathEditor';
import { ControlPanel } from '../components/ControlPanel';

export function FloorplanEditor({ floorplanId }: { floorplanId: string }) {
  const [floorplan, setFloorplan] = useState<Floorplan | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    listFloorplans().then((all) => setFloorplan(all.find((f) => f.id === floorplanId) ?? null));
    listPlacements(floorplanId).then(setPlacements);
    listThemes().then(setThemes);
    listControllers().then(setControllers);
  }, [floorplanId]);

  function toggleSelect(placementId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(placementId)) {
        next.delete(placementId);
      } else {
        next.add(placementId);
      }
      return next;
    });
  }

  async function handleNewSegment(points: { x: number; y: number }[]) {
    if (controllers.length === 0) return;
    const { placement } = await addPlacement(floorplanId, {
      controllerId: controllers[0].id,
      wledSegId: 0,
      points,
      lengthMeters: null
    });
    setPlacements((prev) => [...prev, placement]);
    setDrawing(false);
  }

  async function handleApply(action: ControlAction) {
    const members = placements
      .filter((p) => selected.has(p.id))
      .map((p) => ({ controllerId: p.controllerId, wledSegId: p.wledSegId }));
    await applyControl(members, action);
  }

  if (!floorplan) return <p>Loading...</p>;

  return (
    <div className="section">
      <FloorplanCanvas
        floorplan={floorplan}
        placements={placements}
        selected={selected}
        onToggleSelect={toggleSelect}
      />
      {drawing ? (
        <SegmentPathEditor onComplete={handleNewSegment} />
      ) : (
        <button type="button" className="btn btn-secondary" onClick={() => setDrawing(true)}>
          Draw new segment
        </button>
      )}
      <ControlPanel
        selectedMembers={placements
          .filter((p) => selected.has(p.id))
          .map((p) => ({ controllerId: p.controllerId, wledSegId: p.wledSegId }))}
        themes={themes}
        onApply={handleApply}
      />
    </div>
  );
}
