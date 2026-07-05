import { describe, it, expect, beforeEach } from 'vitest';
import { getRecentColors, pushRecentColor } from '../../lib/recentColors';

describe('recentColors', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and persists pushes', () => {
    expect(getRecentColors()).toEqual([]);
    pushRecentColor('#FF0000');
    expect(getRecentColors()).toEqual(['#ff0000']); // normalized lowercase
    expect(JSON.parse(localStorage.getItem('uber-wled.recent-colors')!)).toEqual(['#ff0000']);
  });

  it('dedupes by moving a repeated color to the front', () => {
    pushRecentColor('#111111');
    pushRecentColor('#222222');
    const result = pushRecentColor('#111111');
    expect(result).toEqual(['#111111', '#222222']);
  });

  it('caps at 12 entries', () => {
    for (let i = 0; i < 15; i++) pushRecentColor(`#0000${i.toString(16).padStart(2, '0')}`);
    const colors = getRecentColors();
    expect(colors).toHaveLength(12);
    expect(colors[0]).toBe('#00000e');
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('uber-wled.recent-colors', '{not json');
    expect(getRecentColors()).toEqual([]);
  });
});
