import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PresetImportModal } from '../sections/themes/PresetImportModal';

afterEach(() => vi.unstubAllGlobals());

const controllers = [
  { id: 'c1', name: 'Porch', host: '10.0.0.5', source: 'manual' as const, stale: false, pinnedAssetPattern: null }
];

const preview = {
  candidates: [
    { presetId: 5, theme: { name: 'USA', effect: 76, palette: 5, colors: [[255, 0, 0]], brightness: 64 }, status: 'new' },
    { presetId: 6, theme: { name: 'Candy Cane', effect: 34, palette: 0, colors: [[255, 0, 0]], brightness: 128 }, status: 'conflict', existingThemeId: 'x2' },
    { presetId: 7, theme: { name: 'Christmas Chase', effect: 34, palette: 5, colors: [[255, 0, 0]], brightness: 255 }, status: 'duplicate', existingThemeId: 'x1' }
  ],
  skipped: [{ presetId: 8, name: 'TV Architectural', reason: 'no effect on its first segment' }]
};

function stub() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/themes/preset-import/c1' && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => preview });
    }
    if (url === '/api/themes/preset-import' && method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ created: 1, overwritten: 1 }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('PresetImportModal', () => {
  it('groups presets by status and imports new + resolved-conflict, skipping duplicates', async () => {
    const fetchMock = stub();
    const onImported = vi.fn();
    render(
      <PresetImportModal open controllers={controllers} live={new Map()} onClose={() => {}} onImported={onImported} />
    );

    // The preview groups render.
    await screen.findByText('USA');
    expect(screen.getByText(/Name already used, different settings/)).toBeTruthy();
    expect(screen.getByText(/Already imported/)).toBeTruthy();
    expect(screen.getByText(/TV Architectural \(no effect/)).toBeTruthy();

    // Default: only the 'new' USA is included (conflicts default to skip).
    expect(screen.getByRole('button', { name: /Import 1 theme/ })).toBeTruthy();

    // Resolve the Candy Cane conflict to overwrite the existing theme.
    fireEvent.change(screen.getByLabelText('Candy Cane conflict action'), { target: { value: 'overwrite' } });
    const importBtn = await screen.findByRole('button', { name: 'Import 2 themes' });
    fireEvent.click(importBtn);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/themes/preset-import', expect.objectContaining({ method: 'POST' }))
    );
    const body = JSON.parse(
      (fetchMock.mock.calls.find(([u, i]) => u === '/api/themes/preset-import' && (i as RequestInit)?.method === 'POST')![1] as RequestInit).body as string
    );
    // USA imported as new; Candy Cane overwrites x2; the duplicate is omitted.
    expect(body.imports).toEqual([
      { name: 'USA', effect: 76, palette: 5, colors: [[255, 0, 0]], brightness: 64, overwriteThemeId: null },
      { name: 'Candy Cane', effect: 34, palette: 0, colors: [[255, 0, 0]], brightness: 128, overwriteThemeId: 'x2' }
    ]);
    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ created: 1, overwritten: 1 }));
  });

  it('imports a conflict under a new name when "rename" is chosen', async () => {
    const fetchMock = stub();
    render(
      <PresetImportModal open controllers={controllers} live={new Map()} onClose={() => {}} onImported={vi.fn()} />
    );
    await screen.findByText('USA');

    // Deselect the 'new' USA so only the renamed conflict imports.
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Candy Cane conflict action'), { target: { value: 'rename' } });
    fireEvent.change(screen.getByLabelText('Candy Cane new name'), { target: { value: 'Candy Cane (Porch)' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 theme' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/themes/preset-import', expect.objectContaining({ method: 'POST' }))
    );
    const body = JSON.parse(
      (fetchMock.mock.calls.find(([u, i]) => u === '/api/themes/preset-import' && (i as RequestInit)?.method === 'POST')![1] as RequestInit).body as string
    );
    expect(body.imports).toEqual([
      { name: 'Candy Cane (Porch)', effect: 34, palette: 0, colors: [[255, 0, 0]], brightness: 128, overwriteThemeId: null }
    ]);
  });
});
