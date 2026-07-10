import type { Controller, Group, ScheduleControllerTarget } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';

export interface TargetValue {
  groupId: string | null;
  controllers: ScheduleControllerTarget[] | null;
}

/**
 * Picks exactly one of a Room group or a set of specific controllers
 * directly (each whole-device — no per-segment picker here, since that
 * needs a segment list per controller and nothing so far has asked for
 * scheduling a single segment directly rather than via a group). Shared by
 * WeeklyScheduleForm and CalendarEventForm so both use the same target
 * model and the same live-name preference for controller options.
 */
export function TargetPicker({
  idPrefix,
  groups,
  controllers,
  live,
  value,
  onChange
}: {
  idPrefix: string;
  groups: Group[];
  controllers: Controller[];
  live: Map<string, LiveStatusEntry>;
  value: TargetValue;
  onChange: (next: TargetValue) => void;
}) {
  // null controllers = group mode; an array (even empty, e.g. right after
  // switching modes with nothing picked yet) = controller mode.
  const mode: 'group' | 'controller' = value.controllers !== null ? 'controller' : 'group';
  const selectedIds = new Set((value.controllers ?? []).map((c) => c.controllerId));

  function selectGroupMode() {
    if (mode === 'group') return;
    onChange({ groupId: groups[0]?.id ?? null, controllers: null });
  }
  function selectControllerMode() {
    if (mode === 'controller') return;
    const first = controllers[0];
    onChange({ groupId: null, controllers: first ? [{ controllerId: first.id, wledSegId: null }] : [] });
  }
  function toggleController(controllerId: string) {
    const next = selectedIds.has(controllerId)
      ? (value.controllers ?? []).filter((c) => c.controllerId !== controllerId)
      : [...(value.controllers ?? []), { controllerId, wledSegId: null }];
    onChange({ groupId: null, controllers: next });
  }

  return (
    <div className="target-picker">
      <div className="target-picker-mode" role="radiogroup" aria-label="Target type">
        <label className="target-picker-mode-option">
          <input
            type="radio"
            name={`${idPrefix}-target-mode`}
            checked={mode === 'group'}
            onChange={selectGroupMode}
          />
          Group
        </label>
        <label className="target-picker-mode-option">
          <input
            type="radio"
            name={`${idPrefix}-target-mode`}
            checked={mode === 'controller'}
            onChange={selectControllerMode}
          />
          Controller(s)
        </label>
      </div>
      {mode === 'group' ? (
        <Field label="Group" htmlFor={`${idPrefix}-target-group`}>
          {groups.length === 0 ? (
            <p className="empty-state">No room groups — target specific controllers instead.</p>
          ) : (
            <Select
              id={`${idPrefix}-target-group`}
              label="target group"
              showLabel={false}
              value={value.groupId ?? ''}
              onChange={(v) => onChange({ groupId: v, controllers: null })}
              options={groups.map((g) => ({ value: g.id, label: g.name }))}
            />
          )}
        </Field>
      ) : (
        <Field label="Controllers" htmlFor={`${idPrefix}-target-controllers`}>
          {controllers.length === 0 ? (
            <p className="empty-state">No controllers yet.</p>
          ) : (
            <ul id={`${idPrefix}-target-controllers`} className="target-picker-controller-list">
              {controllers.map((c) => {
                const name = live.get(c.id)?.info?.name || c.name;
                return (
                  <li key={c.id}>
                    <label className="target-picker-controller-option">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleController(c.id)}
                      />
                      {name}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </Field>
      )}
    </div>
  );
}
