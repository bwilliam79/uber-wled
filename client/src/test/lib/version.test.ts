import { describe, it, expect } from 'vitest';
import { isNewerVersion } from '../../lib/version';

describe('isNewerVersion', () => {
  it('treats a higher patch, minor, or major as newer', () => {
    expect(isNewerVersion('1.5.3', '1.5.2')).toBe(true);
    expect(isNewerVersion('1.6.0', '1.5.9')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('treats equal or lower versions as not newer', () => {
    expect(isNewerVersion('1.5.2', '1.5.2')).toBe(false);
    expect(isNewerVersion('1.4.9', '1.5.0')).toBe(false);
    // The live bug: an older server package.json must never look like an update
    // just because it differs from the running client bundle.
    expect(isNewerVersion('2.16.1', '2.16.2')).toBe(false);
    expect(isNewerVersion('2.10.1', '2.16.2')).toBe(false);
  });
});
