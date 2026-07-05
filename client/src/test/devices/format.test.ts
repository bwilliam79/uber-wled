import { describe, it, expect } from 'vitest';
import { humanizeUptime, signalBars } from '../../sections/devices/format';

describe('humanizeUptime', () => {
  it('renders bare seconds under a minute', () => expect(humanizeUptime(45)).toBe('45s'));
  it('renders minutes under an hour', () => expect(humanizeUptime(300)).toBe('5m'));
  it('renders hours + minutes under a day', () => expect(humanizeUptime(3720)).toBe('1h 2m'));
  it('renders days + hours (real probed uptime 2791487s)', () =>
    expect(humanizeUptime(2791487)).toBe('32d 7h'));
});

describe('signalBars', () => {
  it('maps the real probed signal 98 to 4 bars', () => expect(signalBars(98)).toBe(4));
  it('maps 65 to 3 bars', () => expect(signalBars(65)).toBe(3));
  it('maps 45 to 2 bars', () => expect(signalBars(45)).toBe(2));
  it('maps 10 to 1 bar', () => expect(signalBars(10)).toBe(1));
  it('maps 0 to 0 bars', () => expect(signalBars(0)).toBe(0));
});
