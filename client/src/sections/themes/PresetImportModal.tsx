import { useEffect, useState } from 'react';
import {
  getPresetImportPreview, applyPresetImport,
  type Controller, type PresetImportPreview, type PresetImportCandidate, type PresetImportInstruction
} from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';

type ConflictAction = 'skip' | 'overwrite' | 'rename';
type Decision =
  | { kind: 'new'; include: boolean }
  | { kind: 'conflict'; action: ConflictAction; name: string };

function initialDecisions(preview: PresetImportPreview): Record<number, Decision> {
  const out: Record<number, Decision> = {};
  for (const c of preview.candidates) {
    if (c.status === 'new') out[c.presetId] = { kind: 'new', include: true };
    else if (c.status === 'conflict') out[c.presetId] = { kind: 'conflict', action: 'skip', name: `${c.theme.name} (imported)` };
    // 'duplicate' has no decision — it's already imported.
  }
  return out;
}

/** Turns the resolved decisions into the import instructions the API takes. */
function buildImports(
  candidates: PresetImportCandidate[],
  decisions: Record<number, Decision>
): PresetImportInstruction[] {
  const imports: PresetImportInstruction[] = [];
  for (const c of candidates) {
    const d = decisions[c.presetId];
    if (!d) continue;
    if (d.kind === 'new' && d.include) {
      imports.push({ ...c.theme, overwriteThemeId: null });
    } else if (d.kind === 'conflict') {
      if (d.action === 'overwrite') imports.push({ ...c.theme, overwriteThemeId: c.existingThemeId ?? null });
      else if (d.action === 'rename') imports.push({ ...c.theme, name: d.name.trim() || c.theme.name, overwriteThemeId: null });
    }
  }
  return imports;
}

export function PresetImportModal({
  open, controllers, live, onClose, onImported
}: {
  open: boolean;
  controllers: Controller[];
  live: Map<string, LiveStatusEntry>;
  onClose: () => void;
  onImported: (result: { created: number; overwritten: number }) => void;
}) {
  const firstReachable = controllers.find((c) => !c.stale) ?? controllers[0];
  const [controllerId, setControllerId] = useState<string>(firstReachable?.id ?? '');
  const [preview, setPreview] = useState<PresetImportPreview | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !controllerId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    getPresetImportPreview(controllerId)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setDecisions(initialDecisions(p));
      })
      .catch(() => {
        if (!cancelled) setError('Could not read presets from this controller — is it reachable?');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [open, controllerId]);

  const name = (c: Controller) => live.get(c.id)?.info?.name || c.name;
  const imports = preview ? buildImports(preview.candidates, decisions) : [];

  async function handleImport() {
    setBusy(true);
    try {
      const result = await applyPresetImport(imports);
      onImported(result);
    } catch {
      setError('Import failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const newOnes = preview?.candidates.filter((c) => c.status === 'new') ?? [];
  const conflicts = preview?.candidates.filter((c) => c.status === 'conflict') ?? [];
  const duplicates = preview?.candidates.filter((c) => c.status === 'duplicate') ?? [];

  return (
    <Modal
      open={open}
      size="lg"
      title="Import themes from device presets"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleImport} disabled={busy || imports.length === 0}>
            {busy ? 'Importing…' : `Import ${imports.length} theme${imports.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="preset-import">
        <label htmlFor="preset-import-controller">Controller</label>
        <Select
          id="preset-import-controller" label="Controller" showLabel={false}
          value={controllerId} onChange={setControllerId}
          options={controllers.map((c) => ({ value: c.id, label: c.stale ? `${name(c)} (offline)` : name(c) }))}
        />

        {loading && <p className="empty-state">Reading presets…</p>}
        {error && <div className="error-banner" role="alert">{error}</div>}

        {preview && !loading && (
          <>
            {newOnes.length > 0 && (
              <section className="preset-import-group">
                <h4 className="cs-subhead">New ({newOnes.length})</h4>
                {newOnes.map((c) => {
                  const d = decisions[c.presetId] as { kind: 'new'; include: boolean };
                  return (
                    <label key={c.presetId} className="preset-import-row">
                      <input
                        type="checkbox" checked={d.include}
                        onChange={(e) => setDecisions((prev) => ({ ...prev, [c.presetId]: { kind: 'new', include: e.target.checked } }))}
                      />
                      <span className="preset-import-name">{c.theme.name}</span>
                    </label>
                  );
                })}
              </section>
            )}

            {conflicts.length > 0 && (
              <section className="preset-import-group">
                <h4 className="cs-subhead">Name already used, different settings ({conflicts.length})</h4>
                {conflicts.map((c) => {
                  const d = decisions[c.presetId] as { kind: 'conflict'; action: ConflictAction; name: string };
                  return (
                    <div key={c.presetId} className="preset-import-row preset-import-conflict">
                      <span className="preset-import-name">{c.theme.name}</span>
                      <Select
                        id={`preset-import-action-${c.presetId}`} label={`${c.theme.name} conflict action`} showLabel={false}
                        value={d.action}
                        onChange={(v) => setDecisions((prev) => ({ ...prev, [c.presetId]: { ...d, action: v as ConflictAction } }))}
                        options={[
                          { value: 'skip', label: 'Keep existing (skip)' },
                          { value: 'overwrite', label: 'Overwrite existing' },
                          { value: 'rename', label: 'Import under a new name' }
                        ]}
                      />
                      {d.action === 'rename' && (
                        <input
                          className="input" aria-label={`${c.theme.name} new name`} value={d.name}
                          onChange={(e) => setDecisions((prev) => ({ ...prev, [c.presetId]: { ...d, name: e.target.value } }))}
                        />
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {duplicates.length > 0 && (
              <section className="preset-import-group">
                <h4 className="cs-subhead">Already imported ({duplicates.length})</h4>
                <p className="empty-state">
                  {duplicates.map((c) => c.theme.name).join(', ')} — same name and settings already exist.
                </p>
              </section>
            )}

            {preview.skipped.length > 0 && (
              <section className="preset-import-group">
                <h4 className="cs-subhead">Skipped ({preview.skipped.length})</h4>
                <p className="empty-state">
                  {preview.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}
                </p>
              </section>
            )}

            {preview.candidates.length === 0 && preview.skipped.length === 0 && (
              <p className="empty-state">This controller has no presets to import.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
