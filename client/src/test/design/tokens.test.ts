import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// NOTE: `import.meta.url` is assigned to a variable before being passed to
// `new URL()` rather than inlined as `new URL('../../design/tokens.css', import.meta.url)`.
// Vite statically pattern-matches that exact inline form and rewrites it into
// a dev-server asset URL (http://localhost:3000/...) instead of a real
// filesystem path, which breaks readFileSync under Vitest's jsdom environment.
const moduleUrl = import.meta.url;
const css = readFileSync(new URL('../../design/tokens.css', moduleUrl), 'utf-8');

// v2.0.0 reskin (2026-07-09): teal dark-first system with a light theme,
// per design/README.md + the prototype's :root / [data-theme] blocks.
describe('design tokens (v2 teal system — dark)', () => {
  it.each([
    ['--bg', '#0e0e11'],
    ['--rail', '#08080a'],
    ['--panel', '#18181c'],
    ['--toast', '#1c2b26'],
    ['--text', '#f4f4f6'],
    ['--text2', '#c9c9d0'],
    ['--m1', '#9797a1'],
    ['--m2', '#7a7a84'],
    ['--m3', '#63636c'],
    ['--accent', '#2ee6c0'],
    ['--on-accent', '#04140f'],
    ['--danger', '#ff6b6b'],
    ['--warning', '#ffb020'],
    ['--radius-card', '15px'],
    ['--radius-modal', '20px']
  ])('defines %s: %s', (name, value) => {
    expect(css).toContain(`${name}: ${value};`);
  });

  it('declares Space Grotesk (UI) and IBM Plex Mono (numeric) stacks', () => {
    expect(css).toContain("--font-sans: 'Space Grotesk', system-ui");
    expect(css).toContain("--font-mono: 'IBM Plex Mono'");
  });
});

describe('design tokens (light theme)', () => {
  it('overrides core surfaces + accent under [data-theme="light"]', () => {
    expect(css).toContain('[data-theme="light"]');
    for (const value of ['--bg: #ebe9e4;', '--panel: #f5f4f1;', '--accent: #0c917a;', '--text: #191a1c;']) {
      expect(css).toContain(value);
    }
  });
});

describe('legacy alias bridge (kept until Phase 6)', () => {
  it.each([
    ['--surface', 'var(--panel)'],
    ['--border', 'var(--w8)'],
    ['--text-muted', 'var(--m1)']
  ])('aliases %s → %s so untouched sections theme', (name, value) => {
    expect(css).toContain(`${name}: ${value};`);
  });
});
