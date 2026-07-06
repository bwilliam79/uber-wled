import { useEffect, useState } from 'react';
import type { RoomLabel } from '../../api/client';

export interface RoomLabelsProps {
  labels: RoomLabel[];
  /** Convert client (viewport) coordinates to world coordinates. */
  toWorld(clientX: number, clientY: number): { x: number; y: number };
  onMove(id: string, x: number, y: number): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
}

export function RoomLabels({ labels, toWorld, onMove, onRename, onDelete }: RoomLabelsProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Delete/Backspace deletes the selected label, mirroring the strip-selection
  // shortcut in LayoutSection. Scoped to only listen while a label is selected.
  useEffect(() => {
    if (!selectedId) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDelete(selectedId as string);
        setSelectedId(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, onDelete]);

  function handlePointerDown(e: React.PointerEvent, id: string) {
    if (editingId) return;
    e.stopPropagation();
    setSelectedId(id);
    setDragId(id);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragId) return;
    setDragPos(toWorld(e.clientX, e.clientY));
  }

  function handlePointerUp() {
    if (dragId && dragPos) onMove(dragId, dragPos.x, dragPos.y);
    setDragId(null);
    setDragPos(null);
  }

  function startEdit(label: RoomLabel) {
    setEditingId(label.id);
    setDraft(label.name);
  }

  function commitEdit() {
    const name = draft.trim();
    if (editingId && name) onRename(editingId, name);
    setEditingId(null);
  }

  return (
    <g className="room-label-layer" onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
      {labels.map((label) => {
        const x = dragId === label.id && dragPos ? dragPos.x : label.x;
        const y = dragId === label.id && dragPos ? dragPos.y : label.y;
        if (editingId === label.id) {
          return (
            <foreignObject key={label.id} x={x - 4} y={y - 16} width={140} height={30}>
              <input
                data-testid={`room-label-input-${label.id}`}
                className="room-chip-input"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
            </foreignObject>
          );
        }
        const chipWidth = label.name.length * 7.5 + 20;
        const isSelected = selectedId === label.id;
        return (
          <g
            key={label.id}
            data-testid={`room-label-${label.id}`}
            className={`room-chip${isSelected ? ' selected' : ''}`}
            transform={`translate(${x} ${y})`}
            onPointerDown={(e) => handlePointerDown(e, label.id)}
            onDoubleClick={() => startEdit(label)}
          >
            <rect className="room-chip-bg" x={-chipWidth / 2} y={-11} width={chipWidth} height={22} rx={11} />
            <text className="room-chip-text" textAnchor="middle" dominantBaseline="central">
              {label.name}
            </text>
            <g
              className="room-chip-delete"
              data-testid={`room-label-delete-${label.id}`}
              transform={`translate(${chipWidth / 2 - 3} ${-11})`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(label.id);
                if (isSelected) setSelectedId(null);
              }}
            >
              <circle className="room-chip-delete-bg" r={8} />
              <path className="room-chip-delete-x" d="M-3 -3 L3 3 M3 -3 L-3 3" />
            </g>
          </g>
        );
      })}
    </g>
  );
}
