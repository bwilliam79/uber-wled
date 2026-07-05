import { describe, it, expect } from 'vitest';
import { deviceHash, parseDevicesHash } from '../../sections/devices/route';

describe('parseDevicesHash', () => {
  it('parses the list route', () =>
    expect(parseDevicesHash('#/devices')).toEqual({ controllerId: null, tab: 'info' }));
  it('parses a bare detail route as the Info tab', () =>
    expect(parseDevicesHash('#/devices/c1')).toEqual({ controllerId: 'c1', tab: 'info' }));
  it('parses an explicit tab (Phase H deep-links to update)', () =>
    expect(parseDevicesHash('#/devices/c1/update')).toEqual({ controllerId: 'c1', tab: 'update' }));
  it('falls back to info for unknown tabs', () =>
    expect(parseDevicesHash('#/devices/c1/bogus')).toEqual({ controllerId: 'c1', tab: 'info' }));
});

describe('deviceHash', () => {
  it('round-trips both forms', () => {
    expect(deviceHash('c1')).toBe('#/devices/c1');
    expect(deviceHash('c1', 'config')).toBe('#/devices/c1/config');
    expect(parseDevicesHash(deviceHash('c1', 'segments'))).toEqual({ controllerId: 'c1', tab: 'segments' });
  });
});
