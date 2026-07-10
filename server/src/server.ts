import { createApp } from './app.js';
import { createDb } from './db/client.js';
import { runDiscoveryCycle } from './discovery/service.js';
import { pollAllControllerStatus } from './controllers/statusPoller.js';
import { SchedulerEngine } from './schedules/engine.js';
import { applyActionV2, type ControlAction } from './control/actionMap.js';
import { seedHolidaysIfEmpty } from './calendar/repository.js';
import { createSettingsRepository } from './settings/repository.js';
import { runAutoBackupIfDue, autoBackupDir } from './backup/autoBackup.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const DB_PATH = process.env.DB_PATH ?? './data/uber-wled.db';

const db = createDb(DB_PATH);
seedHolidaysIfEmpty(db);
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`uber-wled server listening on port ${PORT}`);
});

const settings = createSettingsRepository(db);
const intervalMinutes = settings.get().discoveryRescanIntervalMinutes;

runDiscoveryCycle(db);
setInterval(() => runDiscoveryCycle(db), Math.max(1, intervalMinutes) * 60_000);

const statusPollIntervalMinutes = settings.get().controllerStatusPollIntervalMinutes;

pollAllControllerStatus(db);
setInterval(() => pollAllControllerStatus(db), Math.max(1, statusPollIntervalMinutes) * 60_000);

const scheduler = new SchedulerEngine(db, (members, action) =>
  applyActionV2(db, members, action as ControlAction));
scheduler.start();

// Nightly config auto-backup (once per calendar day, kept to the last N),
// written next to the DB. Runs on startup + hourly so it survives restarts.
const backupsDir = autoBackupDir(DB_PATH);
const runAutoBackup = () => {
  try {
    runAutoBackupIfDue(db, backupsDir);
  } catch (err) {
    console.error('auto-backup failed:', err);
  }
};
runAutoBackup();
setInterval(runAutoBackup, 60 * 60_000);
