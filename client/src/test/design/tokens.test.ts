import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// NOTE: `import.meta.url` is assigned to a variable before being passed to
// `new URL()` rather than inlined as `new URL('../../design/tokens.css', import.meta.url)`.
// Vite statically pattern-matches that exact inline form and rewrites it into
// a dev-server asset URL (http://localhost:3000/...) instead of a real
// filesystem path, which breaks readFileSync under Vitest's jsdom environment.
const moduleUrl = import.meta.url;
const css = readFileSync(new URL('../../design/tokens.css', moduleUrl), 'utf-8');

// The palette was rethemed (2026-07-09) from the original blue-slate/grey
// master-plan values to a neutral-charcoal surface set with an emerald accent
// (Operator-inspired). These assertions track the current contract.
describe('design tokens (charcoal + emerald contract)', () => {
  it.each([
    ['--bg', '#0A0A0C'],
    ['--surface', '#141417'],
    ['--surface-2', '#1D1D21'],
    ['--border', 'rgba(255,255,255,.09)'],
    ['--text', '#F4F4F6'],
    ['--text-muted', '#9A9AA4'],
    ['--accent', '#10B981'],
    ['--accent-soft', 'rgba(16,185,129,.15)'],
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
