import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deleteTheme, importThemesFile, THEMES_EXPORT_URL,
  type ControllerCapabilities, type CustomTheme
} from '../../api/client';
import { useCapabilities, useControllers, useThemes } from '../../api/queries';
import { useLiveStatus } from '../../api/live';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { ImportButton } from '../../components/ImportButton';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { triggerDownload, readJsonFile } from '../../lib/fileTransfer';
import { LedPreview } from '../../components/ui/LedPreview';
import { effectToPreview, themeColorsString } from '../../lib/effectPreview';
import { rgbToHex } from '../../lib/color';
import { ThemeForm } from './ThemeForm';
import { PresetImportModal } from './PresetImportModal';
import './themes.css';

function ThemeRow({
  theme,
  capabilities,
  onEdit,
  onDelete
}: {
  theme: CustomTheme;
  capabilities: ControllerCapabilities | undefined;
  onEdit: (theme: CustomTheme) => void;
  onDelete: (id: string) => void;
}) {
  const effectName = capabilities?.effects[theme.effect] ?? `Effect #${theme.effect}`;
  const slotHexes = theme.colors.map(rgbToHex);
  const previewEffect = effectToPreview(effectName);
  const previewColors = themeColorsString(theme.colors);
  return (
    <li className="theme-row">
      <div className="theme-row-info">
        <span className="theme-row-name">{theme.name}</span>
        <span className="theme-row-meta">{effectName}</span>
      </div>
      <div className="theme-row-preview">
        <div className="theme-row-preview-well" data-testid={`theme-preview-${theme.id}`}>
          <LedPreview
            effect={previewEffect}
            colors={previewColors}
            count={48}
            speed={1}
            className="theme-row-preview-canvas"
            ariaLabel={`${theme.name} preview`}
          />
        </div>
        <span className="theme-row-swatches">
          {slotHexes.map((hex, i) => (
            <span key={i} className="theme-row-swatch" style={{ backgroundColor: hex }} />
          ))}
        </span>
      </div>
      <div className="theme-row-actions">
        <Button variant="secondary" size="sm" aria-label={`Edit ${theme.name}`} onClick={() => onEdit(theme)}>
          Edit
        </Button>
        <Button variant="danger" size="sm" aria-label={`Remove ${theme.name}`} onClick={() => onDelete(theme.id)}>
          Remove
        </Button>
      </div>
    </li>
  );
}

export function ThemesSection() {
  const controllers = useControllers();
  const live = useLiveStatus((controllers.data ?? []).map((c) => c.id));
  const themes = useThemes();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const defaultSource = useMemo(() => {
    const list = controllers.data ?? [];
    return (list.find((c) => !c.stale) ?? list[0])?.id ?? null;
  }, [controllers.data]);
  const effectiveSource = sourceId ?? defaultSource;
  const capabilities = useCapabilities(effectiveSource);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editingTheme, setEditingTheme] = useState<CustomTheme | null>(null);
  const [presetImportOpen, setPresetImportOpen] = useState(false);

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

  const themeCount = themes.data?.length ?? 0;

  return (
    <section className="section themes-section">
      <div className="themes-header">
        <h2>Themes</h2>
        <div className="themes-header-actions">
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
            disabled={(controllers.data ?? []).length === 0}
            onClick={() => setPresetImportOpen(true)}
          >
            From device presets
          </Button>
        </div>
      </div>
      <Card className="themes-list-card">
        {themes.data && themes.data.length === 0 && (
          <p className="empty-state">No custom themes yet.</p>
        )}
        {themes.data && themes.data.length > 0 && (
          <ul className="theme-list">
            {themes.data.map((t) => (
              <ThemeRow
                key={t.id}
                theme={t}
                capabilities={capabilities.data}
                onEdit={setEditingTheme}
                onDelete={(id) => {
                  if (editingTheme?.id === id) setEditingTheme(null);
                  removeTheme.mutate(id);
                }}
              />
            ))}
          </ul>
        )}
      </Card>
      <Card className="theme-form-card">
        <div className="theme-form-source">
          <label htmlFor="theme-source">Source controller</label>
          <Select
            id="theme-source"
            label="Source controller"
            showLabel={false}
            value={effectiveSource ?? ''}
            onChange={(v) => setSourceId(v)}
            options={(controllers.data ?? []).map((c) => {
              const name = live.get(c.id)?.info?.name || c.name;
              return { value: c.id, label: c.stale ? `${name} (offline)` : name };
            })}
          />
          <span className="field-hint">Effect and palette options are read from this controller</span>
        </div>
        {effectiveSource === null && controllers.data && (
          <p className="empty-state">Add a controller to create themes.</p>
        )}
        {effectiveSource !== null && capabilities.isPending && (
          <p className="empty-state">Loading effects and palettes…</p>
        )}
        {capabilities.isError && (
          <p className="empty-state" role="alert">
            Could not load capabilities for this controller — pick another source.
          </p>
        )}
        {/* Add flow stays inline; editing happens in a modal (below) so the
            user isn't sent scrolling to the bottom of the page to change a
            theme. */}
        {capabilities.data && <ThemeForm capabilities={capabilities.data} />}
      </Card>

      <Modal
        open={editingTheme !== null && capabilities.data !== undefined}
        onClose={() => setEditingTheme(null)}
        title={editingTheme ? `Edit “${editingTheme.name}”` : 'Edit theme'}
        size="lg"
      >
        {editingTheme && capabilities.data && (
          <ThemeForm
            key={editingTheme.id}
            capabilities={capabilities.data}
            editing={editingTheme}
            onDone={() => setEditingTheme(null)}
          />
        )}
      </Modal>

      <PresetImportModal
        open={presetImportOpen}
        controllers={controllers.data ?? []}
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
