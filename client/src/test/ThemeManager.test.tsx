import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeManager } from '../components/ThemeManager';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(initialThemes: unknown[]) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/themes' && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => initialThemes });
    }
    if (url === '/api/themes' && method === 'POST') {
      const body = JSON.parse(init!.body as string);
      return Promise.resolve({ ok: true, json: async () => ({ id: 't1', ...body }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ThemeManager', () => {
  it('shows the empty state when there are no themes', async () => {
    stubFetch([]);

    render(<ThemeManager />);

    await waitFor(() => expect(screen.getByText('No custom themes yet.')).toBeTruthy());
  });

  it('renders the create theme form', async () => {
    stubFetch([]);

    render(<ThemeManager />);

    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy());
    expect(screen.getByLabelText('Effect')).toBeTruthy();
    expect(screen.getByLabelText('Palette')).toBeTruthy();
    expect(screen.getByLabelText('Brightness')).toBeTruthy();
    expect(screen.getByLabelText('Color')).toBeTruthy();
    expect(screen.getByText('Add theme')).toBeTruthy();
  });

  it('adds a theme via addTheme and shows it in the list on success', async () => {
    const fetchMock = stubFetch([]);

    render(<ThemeManager />);

    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sunset' } });
    fireEvent.change(screen.getByLabelText('Effect'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Palette'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Brightness'), { target: { value: '180' } });
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#ff6400' } });
    fireEvent.click(screen.getByText('Add theme'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/themes',
        expect.objectContaining({ method: 'POST' })
      )
    );

    const postCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/themes' && init?.method === 'POST');
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body).toEqual({
      name: 'Sunset',
      effect: 2,
      palette: 5,
      brightness: 180,
      colors: [[255, 100, 0]]
    });

    await waitFor(() => expect(screen.getByText('Sunset')).toBeTruthy());
    expect(screen.queryByText('No custom themes yet.')).toBeNull();
  });

  it('shows an error banner when adding a theme fails', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/themes' && method === 'GET') {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url === '/api/themes' && method === 'POST') {
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ThemeManager />);

    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Broken' } });
    fireEvent.click(screen.getByText('Add theme'));

    await waitFor(() => expect(screen.getByText(/failed/i)).toBeTruthy());
  });
});
