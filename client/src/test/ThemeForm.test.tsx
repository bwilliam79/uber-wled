import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './renderWithQuery';
import { ThemeForm } from '../sections/themes/ThemeForm';
import { CAPS } from './fixtures/capabilities';

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

afterEach(() => vi.unstubAllGlobals());

describe('ThemeForm', () => {
  it('builds the POST /api/themes payload from picker, color-slot, and brightness state', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/themes' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 't9', ...JSON.parse(init.body as string) })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<ThemeForm capabilities={CAPS} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sunset' } });
    fireEvent.click(screen.getByRole('option', { name: /Blink/ }));   // effect id 1
    fireEvent.click(screen.getByRole('option', { name: /Party/ }));   // palette id 6
    fireEvent.click(screen.getByLabelText('Color 1: #ffffff'));       // open slot 1 popover
    fireEvent.change(screen.getByLabelText('Color 1 hex'), { target: { value: '#ff8800' } });
    fireEvent.change(screen.getByLabelText('Brightness'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add theme' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/themes', expect.objectContaining({ method: 'POST' }))
    );
    const call = fetchMock.mock.calls.find(([u, i]) => u === '/api/themes' && i?.method === 'POST')!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      name: 'Sunset',
      effect: 1,
      palette: 6,
      brightness: 200,
      speed: 128,
      intensity: 128,
      colors: [[255, 136, 0], [0, 0, 0], [0, 0, 0]],
      directions: null
    });
  });

  it('edits per-controller direction and sends only set entries on PUT', async () => {
    const editing = {
      id: 't1', name: 'Arkansas', effect: 1, palette: 0, brightness: 140, speed: 235, intensity: 120,
      colors: [[255, 255, 255], [200, 0, 25], [0, 0, 0]],
      directions: { left: { rev: false } }
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/controllers') {
        return Promise.resolve({ ok: true, json: async () => ([
          { id: 'left', name: 'fp-left', host: 'h1', source: 'manual', stale: false, pinnedAssetPattern: null },
          { id: 'right', name: 'fp-right', host: 'h2', source: 'manual', stale: false, pinnedAssetPattern: null }
        ]) });
      }
      if (url === '/api/themes/t1' && init?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 't1', ...JSON.parse(init.body as string) }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<ThemeForm capabilities={CAPS} editing={editing} />);

    const left = await screen.findByRole('radiogroup', { name: 'fp-left direction' });
    expect(within(left).getByRole('radio', { name: 'Normal' }).getAttribute('aria-checked')).toBe('true');
    const right = screen.getByRole('radiogroup', { name: 'fp-right direction' });
    expect(within(right).getByRole('radio', { name: 'Leave as is' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(within(right).getByRole('radio', { name: 'Reversed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/themes/t1' && i?.method === 'PUT')).toBe(true));
    const put = fetchMock.mock.calls.find(([u, i]) => u === '/api/themes/t1' && i?.method === 'PUT')!;
    expect(JSON.parse((put[1] as RequestInit).body as string).directions)
      .toEqual({ left: { rev: false }, right: { rev: true } });
  });

  it('disables submit until a name is entered', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    renderWithQuery(<ThemeForm capabilities={CAPS} />);
    expect((screen.getByRole('button', { name: 'Add theme' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
