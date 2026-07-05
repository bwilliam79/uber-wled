import { describe, it, expect } from 'vitest';
import { createDb } from '../../src/db/client.js';

describe('createDb', () => {
  it('creates all expected tables', () => {
    const db = createDb(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name)
      .sort();
    expect(tables).toEqual([
      'calendar_events',
      'controller_capabilities',
      'controller_status',
      'controllers',
      'group_members',
      'groups',
      'room_labels',
      'schedules',
      'settings',
      'strips',
      'themes',
      'wled_releases'
    ]);
  });
});
