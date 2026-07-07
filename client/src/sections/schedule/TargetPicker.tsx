import type { Controller, Group } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';

export interface TargetValue {
  groupId: string | null;
  controllerId: string | null;
  wledSegId: number | null;
}

/**
 * Picks exactly one of a Room group or a specific controller (the whole
 * device — no per-segment picker here, since that needs a segment list per
 * controller and nothing so far has asked for scheduling a single segment
 * directly rather than via a group). Shared by WeeklyScheduleForm and
 * CalendarEventForm so both use the same target model and the same
 * live-name preference for controller options.
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
  const mode: 'group' | 'controller' = value.controllerId ? 'controller' : 'group';

  function selectGroupMode() {
    if (mode === 'group') return;
    onChange({ groupId: groups[0]?.id ?? null, controllerId: null, wledSegId: null });
  }
  function selectControllerMode() {
    if (mode === 'controller') return;
    onChange({ groupId: null, controllerId: controllers[0]?.id ?? null, wledSegId: null });
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
          Controller
        </label>
      </div>
      {mode === 'group' ? (
        <Field label="Group" htmlFor={`${idPrefix}-target-group`}>
          {groups.length === 0 ? (
            <p className="empty-state">No groups yet — add one on Home first.</p>
          ) : (
            <Select
              id={`${idPrefix}-target-group`}
              label="target group"
              showLabel={false}
              value={value.groupId ?? ''}
              onChange={(v) => onChange({ groupId: v, controllerId: null, wledSegId: null })}
              options={groups.map((g) => ({ value: g.id, label: g.name }))}
            />
          )}
        </Field>
      ) : (
        <Field label="Controller" htmlFor={`${idPrefix}-target-controller`}>
          {controllers.length === 0 ? (
            <p className="empty-state">No controllers yet.</p>
          ) : (
            <Select
              id={`${idPrefix}-target-controller`}
              label="target controller"
              showLabel={false}
              value={value.controllerId ?? ''}
              onChange={(v) => onChange({ groupId: null, controllerId: v, wledSegId: null })}
              options={controllers.map((c) => ({
                value: c.id,
                label: live.get(c.id)?.info?.name || c.name
              }))}
            />
          )}
        </Field>
      )}
    </div>
  );
}
