import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './renderWithQuery';
import { ThemesSection } from '../sections/themes/ThemesSection';
import { CAPS } from './fixtures/capabilities';

const { liveMap } = vi.hoisted(() => ({ liveMap: new Map() }));
vi.mock('../api/live', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/live')>();
  return { ...actual, useLiveStatus: () => liveMap };
});

vi.mock('../components/ui/ColorWheel', () => ({
  ColorWheel: ({ color, onChange }: { color: { r: number; g: number; b: number }; onChange: (c: { r: number; g: number; b: number }) => void }) => (
    <input
      aria-label="color wheel"
      value={`#${[color.r, color.g, color.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`}
      onChange={(e) => {
        const hex = e.target.value;
        onChange({
          r: parseInt(hex.slice(1, 3), 16),
          g: parseInt(hex.slice(3, 5), 16),
          b: parseInt(hex.slice(5, 7), 16)
        });
      }}
    />
  )
}));

afterEach(() => {
  vi.unstubAllGlobals();
  liveMap.clear();
});

const CONTROLLERS = [
  { id: 'c0', name: 'Attic', host: '10.0.0.40', source: 'manual', stale: true, pinnedAssetPattern: null },
  { id: 'c1', name: 'Cabinet Lights', host: '192.168.1.86', source: 'discovered', stale: false, pinnedAssetPattern: null }
];
const THEMES = [
  { id: 't1', name: 'Sunset Party', effect: 1, palette: 6, colors: [[255, 136, 0], [0, 0, 0], [0, 0, 0]], brightness: 200 }
];

function stubFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/controllers' && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => CONTROLLERS });
    }
    if (url === '/api/themes' && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => THEMES });
    }
    if (url === '/api/controllers/c1/capabilities') {
      return Promise.resolve({ ok: true, json: async () => CAPS });
    }
    if (url === '/api/controllers/c0/capabilities') {
      return Promise.resolve({ ok: false, json: async () => ({ error: 'unreachable' }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ThemesSection', () => {
  it('defaults the source controller to the first reachable one and previews each theme row', async () => {
    stubFetch();
    renderWithQuery(<ThemesSection />);
    await waitFor(() =>
      expect((screen.getByLabelText('Source controller') as HTMLSelectElement).value).toBe('c1')
    );
    const row = (await screen.findByText('Sunset Party')).closest('li')!;
    // effect name resolved through the capability cache, not shown as a raw id
    expect(within(row as HTMLElement).getByText('Blink')).toBeTruthy();
    const bar = screen.getByTestId('theme-preview-t1') as HTMLElement;
    expect(bar.style.backgroundImage).not.toBe('');
    // three color swatches rendered from the stored theme colors
    expect((row as HTMLElement).querySelectorAll('.theme-row-swatch')).toHaveLength(3);
  });

  it('the Source controller dropdown prefers the live device-reported name over the stored controller name', async () => {
    liveMap.set('c1', { reachable: true, state: {}, info: { name: 'Cabinet', ver: '16.0.0', leds: { count: 48 }, arch: 'esp32' } });
    stubFetch();
    renderWithQuery(<ThemesSection />);
    await waitFor(() => expect((screen.getByLabelText('Source controller') as HTMLSelectElement).value).toBe('c1'));
    expect(screen.getByRole('option', { name: 'Cabinet' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Cabinet Lights' })).toBeNull();
  });

  it('deletes a theme via DELETE /api/themes/:id', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<ThemesSection />);
    fireEvent.click(await screen.findByLabelText('Remove Sunset Party'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/themes/t1', expect.objectContaining({ method: 'DELETE' }))
    );
    await waitFor(() => expect(screen.queryByText('Sunset Party')).toBeNull());
  });
});
