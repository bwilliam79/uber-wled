import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './renderWithQuery';
import { ScheduleManager } from '../sections/schedule/ScheduleManager';

afterEach(() => vi.unstubAllGlobals());

describe('ScheduleManager empty target copy', () => {
  it('shows No action set instead of Group emdash when no group target is set', async () => {
    const existing = {
      id: 's2', name: 'Orphan', triggerType: 'weekly', cronExpr: null,
      daysOfWeek: [1], timeOfDay: '18:00', offsetMinutes: 0, latitude: null, longitude: null,
      groupId: null, controllers: null,
      actionType: 'theme', actionPayload: { themeId: 't1' }, enabled: true
    };
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/schedules') return Promise.resolve({ ok: true, json: async () => [existing] });
      if (url === '/api/calendar-events') return Promise.resolve({ ok: true, json: async () => [] });
      if (url === '/api/controllers') return Promise.resolve({ ok: true, json: async () => [] });
      if (url === '/api/groups') return Promise.resolve({ ok: true, json: async () => [] });
      if (url === '/api/themes') {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 't1', name: 'Spooky', effect: 2, palette: 6, colors: [[255, 140, 0]], brightness: 128, speed: 128, intensity: 128 }]
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));
    renderWithQuery(<ScheduleManager />);
    await screen.findByText('Orphan');
    expect(screen.getByText(/No action set/)).toBeTruthy();
    expect(screen.queryByText(/Group/)).toBeNull();
  });
});
