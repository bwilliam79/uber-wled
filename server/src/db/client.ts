import Database from 'better-sqlite3';
import { runMigrations } from './schema.js';

export function createDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}
