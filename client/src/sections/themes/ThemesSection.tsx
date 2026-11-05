import { themeToPatch } from '../../lib/themePatch';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  applyControl, deleteTheme, importThemesFile, THEMES_EXPORT_URL,
  type ControllerCapabilities, type CustomTheme
} from '../../api/client';
import { useCapabilities, useControllers, useThemes } from '../../api/queries';
import { useLiveStatus } from '../../api/live';
import { Button } from '../../components/ui/Button';
import { ImportButton } from '../../components/ImportButton';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { MoreMenu } from '../../components/ui/MoreMenu';
import { SearchInput } from '../../components/ui/SearchInput';
import { Select } from '../../components/ui/Select';
import { triggerDownload, readJsonFile } from '../../lib/fileTransfer';
import { LedPreview } from '../../components/ui/LedPreview';
import { effectToPreview, resolvePreviewColors, resolveThemeSwatches } from '../../lib/effectPreview';
import { ThemeForm } from './ThemeForm';
import { PresetImportModal } from './PresetImportModal';
import './themes.css';

function ThemeRow({
  theme,
  capabilities,
  onApply,
  onEdit,
  onDelete,
  applying
}: {
  theme: CustomTheme;
  capabilities: ControllerCapabilities | undefined;
  onApply: (theme: CustomTheme) => void;
  onEdit: (theme: CustomTheme) => void;
  onDelete: (id: string) => void;
  applying: boolean;
}) {
  const effectName = capabilities?.effects[theme.effect] ?? `Effect #${theme.effect}`;
  const paletteName = capabilities?.palettes[theme.palette];
  const previewEffect = effectToPreview(effectName);
  const fxMeta = capabilities?.fxMeta.find((m) => m.id === theme.effect);
  const palettePreview = capabilities?.palettePreviews[theme.palette];
  const colorOpts = {
    usesPalette: fxMeta?.usesPalette,
    paletteId: theme.palette
  };
  const previewColors = resolvePreviewColors(theme.colors, palettePreview, colorOpts);
  const swatchHexes = resolveThemeSwatches(theme.colors, palettePreview, colorOpts);
  return (
    <li className="theme-row">
      <div className="theme-row-info">
        <span className="theme-row-name">{theme.name}</span>
        <span className="theme-row-meta">{effectName}</span>
        {paletteName && <span className="theme-row-meta">{paletteName}</span>}
      </div>
      <div className="theme-row-preview">
        <div className="theme-row-preview-well" data-testid={`theme-preview-${theme.id}`}>
          <LedPreview
            effect={previewEffect}
            colors={previewColors}
            count={48}
            speed={Math.max(0.15, theme.speed / 128)}
            intensity={theme.intensity}
            className="theme-row-preview-canvas"
            ariaLabel={`${theme.name} preview`}
          />
        </div>
        <span className="theme-row-swatches" aria-label={`${theme.name} colors`}>
          {swatchHexes.map((hex, i) => (
            <span key={`${hex}-${i}`} className="theme-row-swatch" style={{ backgroundColor: hex }} title={hex} />
          ))}
        </span>
      </div>
      <div className="theme-row-actions">
        <Button
          variant="primary"
          size="sm"
          aria-label={`Apply ${theme.name} to fleet`}
          disabled={applying}
          onClick={() => onApply(theme)}
        >
          Apply to fleet…
        </Button>
        <MoreMenu label="More" name={`More actions for ${theme.name}`}>
          <Button variant="secondary" size="sm" aria-label={`Edit ${theme.name}`} onClick={() => onEdit(theme)}>
            Edit
          </Button>
          <Button variant="danger" size="sm" aria-label={`Remove ${theme.name}`} onClick={() => onDelete(theme.id)}>
            Remove
          </Button>
        </MoreMenu>
      </div>
    </li>
  );
}

export function ThemesSection() {
  const controllers = useControllers();
  const live = useLiveStatus((controllers.data ?? []).map((c) => c.id));
  const themes = useThemes();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const defaultSource = useMemo(() => {
    const list = controllers.data ?? [];
    return (list.find((c) => !c.stale) ?? list[0])?.id ?? null;
  }, [controllers.data]);
  const effectiveSource = sourceId ?? defaultSource;
  const capabilities = useCapabilities(effectiveSource);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<CustomTheme | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingApply, setPendingApply] = useState<CustomTheme | null>(null);
  const [presetImportOpen, setPresetImportOpen] = useState(false);
  const [applyingThemeId, setApplyingThemeId] = useState<string | null>(null);

  const list = controllers.data ?? [];
  const offlineCount = list.filter((c) => c.stale || live.get(c.id)?.reachable === false).length;

  function applyThemeToFleet(theme: CustomTheme) {
    if (list.length === 0) {
      toast.show({ title: 'No controllers to apply to', variant: 'error' });
      return;
    }
    const targets = list.map((c) => ({ kind: 'controller' as const, controllerId: c.id }));
    setApplyingThemeId(theme.id);
    applyControl(targets, themeToPatch(theme, { on: true }))
      .then(() => toast.show({ title: `Applied "${theme.name}" to all devices`, variant: 'success' }))
      .catch(() => toast.show({ title: 'Failed to apply theme', variant: 'error' }))
      .finally(() => setApplyingThemeId(null));
  }

  const removeTheme = useMutation({
    mutationFn: deleteTheme,
    onSuccess: (_res, id) => {
      queryClient.setQueryData<CustomTheme[]>(['themes'], (prev) =>
        (prev ?? []).filter((t) => t.id !== id)
      );
    }
  });

  async function handleImport(file: File) {
    try {
      const data = await readJsonFile(file);
      const result = await importThemesFile(data);
      await queryClient.invalidateQueries({ queryKey: ['themes'] });
      toast.show({ title: `Imported ${result.imported} theme${result.imported === 1 ? '' : 's'}`, variant: 'success' });
    } catch (err) {
      toast.show({ title: 'Theme import failed', description: (err as Error).message, variant: 'error' });
    }
  }

  function openCreate() {
    setEditingTheme(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditingTheme(null);
  }

  const themeCount = themes.data?.length ?? 0;
  const visible = (themes.data ?? []).filter((theme) =>
    theme.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const editorVisible = editorOpen || editingTheme !== null;

  return (
    <section className="section themes-section">
      <div className="themes-header">
        <div>
          <h2>Themes</h2>
          <p className="themes-lede">Reusable looks. Saving a theme does not change any lights.</p>
        </div>
        <div className="themes-header-actions">
          <Button variant="primary" onClick={openCreate}>New theme</Button>
          <MoreMenu label="More">
            <Button
              variant="secondary"
              size="sm"
              disabled={themeCount === 0}
              onClick={() => triggerDownload(THEMES_EXPORT_URL)}
            >
              Export
            </Button>
            <ImportButton label="Import" size="sm" onFile={handleImport} />
            <Button
              variant="secondary" size="sm"
              disabled={list.length === 0}
              onClick={() => setPresetImportOpen(true)}
            >
              From device presets
            </Button>
          </MoreMenu>
        </div>
      </div>

      <SearchInput label="Search themes" placeholder="Search themes" value={query} onChange={setQuery} />

      {themes.data && themes.data.length === 0 && (
        <p className="empty-state">
          No custom themes yet.{' '}
          {list.length === 0
            ? <a href="#/settings">Add a controller</a>
            : <button type="button" className="linkish" onClick={openCreate}>New theme</button>}
        </p>
      )}
      {themes.isError && (
        <div className="error-banner" role="alert">Could not load themes.</div>
      )}
      {visible.length > 0 && (
        <ul className="theme-list">
          {visible.map((t) => (
            <ThemeRow
              key={t.id}
              theme={t}
              capabilities={capabilities.data}
              onApply={setPendingApply}
              onEdit={(theme) => { setEditingTheme(theme); setEditorOpen(true); }}
              onDelete={setPendingDelete}
              applying={applyingThemeId === t.id}
            />
          ))}
        </ul>
      )}

      <Modal
        open={editorVisible}
        onClose={closeEditor}
        title={editingTheme ? `Edit “${editingTheme.name}”` : 'New theme'}
        size="lg"
      >
        <div className="theme-form-source">
          <label htmlFor="theme-source">Source controller</label>
          <Select
            id="theme-source"
            label="Source controller"
            showLabel={false}
            value={effectiveSource ?? ''}
            onChange={(v) => setSourceId(v)}
            options={list.map((c) => {
              const name = live.get(c.id)?.info?.name || c.name;
              return { value: c.id, label: c.stale ? `${name} (offline)` : name };
            })}
          />
          <span className="field-hint">Effect and palette options are read from this controller. The preview here is simulated.</span>
        </div>
        {effectiveSource === null && controllers.data && (
          <p className="empty-state">Add a controller to create themes.</p>
        )}
        {effectiveSource !== null && capabilities.isPending && (
          <p className="empty-state" role="status">Loading effects and palettes…</p>
        )}
        {capabilities.isError && (
          <div className="error-banner" role="alert">
            <p>Could not load effects and palettes from this controller.</p>
            <Button variant="secondary" onClick={() => capabilities.refetch()}>Retry</Button>
            <span>Choose another source above.</span>
          </div>
        )}
        {capabilities.data && (
          <ThemeForm
            key={editingTheme?.id ?? 'new'}
            capabilities={capabilities.data}
            editing={editingTheme ?? undefined}
            onDone={closeEditor}
          />
        )}
      </Modal>

      <Modal
        open={pendingApply !== null}
        onClose={() => setPendingApply(null)}
        title="Apply theme to the fleet?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingApply(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pendingApply) applyThemeToFleet(pendingApply);
                setPendingApply(null);
              }}
            >
              Apply to {list.length} controller{list.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <p>
          Apply “{pendingApply?.name}” to all {list.length} controller{list.length === 1 ? '' : 's'}?
          {offlineCount > 0
            ? ` ${offlineCount} ${offlineCount === 1 ? 'is' : 'are'} offline and still included.`
            : ' Every controller is included.'}
        </p>
      </Modal>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Remove theme?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!pendingDelete) return;
                if (editingTheme?.id === pendingDelete) closeEditor();
                removeTheme.mutate(pendingDelete);
                setPendingDelete(null);
              }}
            >
              Remove theme
            </Button>
          </>
        }
      >
        <p>Remove this theme from the library? Lights already showing it are not changed.</p>
      </Modal>

      <PresetImportModal
        open={presetImportOpen}
        controllers={list}
        live={live}
        onClose={() => setPresetImportOpen(false)}
        onImported={async (result) => {
          await queryClient.invalidateQueries({ queryKey: ['themes'] });
          const parts = [
            result.created > 0 ? `${result.created} added` : null,
            result.overwritten > 0 ? `${result.overwritten} overwritten` : null
          ].filter(Boolean);
          toast.show({
            title: parts.length ? `Imported ${parts.join(', ')}` : 'Nothing to import',
            variant: 'success'
          });
          setPresetImportOpen(false);
        }}
      />
    </section>
  );
}
