import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// NOTE: `import.meta.url` is assigned to a variable before being passed to
// `new URL()` rather than inlined as `new URL('../../design/tokens.css', import.meta.url)`.
// Vite statically pattern-matches that exact inline form and rewrites it into
// a dev-server asset URL (http://localhost:3000/...) instead of a real
// filesystem path, which breaks readFileSync under Vitest's jsdom environment.
const moduleUrl = import.meta.url;
const css = readFileSync(new URL('../../design/tokens.css', moduleUrl), 'utf-8');

describe('design tokens (master-plan binding contract)', () => {
  it.each([
    ['--bg', '#0B0F1A'],
    ['--surface', '#131A2A'],
    ['--surface-2', '#1A2338'],
    ['--border', 'rgba(148,163,184,.10)'],
    ['--text', '#E6EAF2'],
    ['--text-muted', '#8A94A8'],
    ['--accent', '#7C6CFF'],
    ['--accent-soft', 'rgba(124,108,255,.16)'],
    ['--success', '#22C55E'],
    ['--danger', '#EF4444'],
    ['--warning', '#F59E0B'],
    ['--radius-card', '16px'],
    ['--radius-control', '10px']
  ])('defines %s: %s', (name, value) => {
    expect(css).toContain(`${name}: ${value};`);
  });

  it('declares the Plus Jakarta Sans stack with a system-ui fallback', () => {
    expect(css).toContain("--font-sans: 'Plus Jakarta Sans', system-ui");
  });
});
