import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../../theme/ThemeProvider';

function stubMatchMedia(prefersLight: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: prefersLight && query.includes('light'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  }));
}

function Probe() {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle} aria-label="toggle">
      {theme}
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  stubMatchMedia(false);
});

describe('ThemeProvider', () => {
  it('defaults to dark and stamps data-theme on the root', async () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByLabelText('toggle').textContent).toBe('dark');
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
  });

  it('toggles to light, updates the root attribute, and persists to localStorage', async () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByLabelText('toggle'));
    expect(screen.getByLabelText('toggle').textContent).toBe('light');
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(localStorage.getItem('uwled.theme')).toBe('light');
    });
  });

  it('honors a stored theme on mount over the OS preference', async () => {
    localStorage.setItem('uwled.theme', 'light');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByLabelText('toggle').textContent).toBe('light');
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));
  });

  it('falls back to the OS preference when nothing is stored', () => {
    stubMatchMedia(true); // prefers light
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByLabelText('toggle').textContent).toBe('light');
  });
});
