import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteTheme, type ControllerCapabilities, type CustomTheme } from '../../api/client';
import { useCapabilities, useControllers, useThemes } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { paletteGradientCss } from '../../lib/paletteCss';
import { rgbToHex } from '../../lib/color';
import { ThemeForm } from './ThemeForm';
import './themes.css';

function ThemeRow({
  theme,
  capabilities,
  onDelete
}: {
  theme: CustomTheme;
  capabilities: ControllerCapabilities | undefined;
  onDelete: (id: string) => void;
}) {
  const effectName = capabilities?.effects[theme.effect] ?? `Effect #${theme.effect}`;
  const slotHexes = theme.colors.map(rgbToHex);
  const gradient = paletteGradientCss(capabilities?.palettePreviews[theme.palette], slotHexes);
  return (
    <li className="theme-row">
      <div className="theme-row-info">
        <span className="theme-row-name">{theme.name}</span>
        <span className="theme-row-meta">{effectName}</span>
      </div>
      <div className="theme-row-preview">
        <span
          className="palette-bar"
          data-testid={`theme-preview-${theme.id}`}
          style={{ backgroundImage: gradient }}
        />
        <span className="theme-row-swatches">
          {slotHexes.map((hex, i) => (
            <span key={i} className="theme-row-swatch" style={{ backgroundColor: hex }} />
          ))}
        </span>
      </div>
      <Button variant="danger" aria-label={`Remove ${theme.name}`} onClick={() => onDelete(theme.id)}>
        Remove
      </Button>
    </li>
  );
}

export function ThemesSection() {
  const controllers = useControllers();
  const themes = useThemes();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const defaultSource = useMemo(() => {
    const list = controllers.data ?? [];
    return (list.find((c) => !c.stale) ?? list[0])?.id ?? null;
  }, [controllers.data]);
  const effectiveSource = sourceId ?? defaultSource;
  const capabilities = useCapabilities(effectiveSource);
  const queryClient = useQueryClient();

  const removeTheme = useMutation({
    mutationFn: deleteTheme,
    onSuccess: (_res, id) => {
      queryClient.setQueryData<CustomTheme[]>(['themes'], (prev) =>
        (prev ?? []).filter((t) => t.id !== id)
      );
    }
  });

  return (
    <section className="section themes-section">
      <h2>Themes</h2>
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
                onDelete={(id) => removeTheme.mutate(id)}
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
            options={(controllers.data ?? []).map((c) => ({
              value: c.id,
              label: c.stale ? `${c.name} (offline)` : c.name
            }))}
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
        {capabilities.data && <ThemeForm capabilities={capabilities.data} />}
      </Card>
    </section>
  );
}
