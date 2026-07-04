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
      'controllers',
      'floorplans',
      'group_members',
      'groups',
      'placements',
      'schedules',
      'themes',
      'wled_releases'
    ]);
  });
});
