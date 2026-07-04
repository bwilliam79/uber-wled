import { createApp } from './app.js';
import { createDb } from './db/client.js';
import { runDiscoveryCycle } from './discovery/service.js';
import { SchedulerEngine } from './schedules/engine.js';
import { applyToMembers } from './control/routes.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const DB_PATH = process.env.DB_PATH ?? './data/uber-wled.db';
const DISCOVERY_INTERVAL_MS = 5 * 60_000;

const db = createDb(DB_PATH);
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`uber-wled server listening on port ${PORT}`);
});

runDiscoveryCycle(db);
setInterval(() => runDiscoveryCycle(db), DISCOVERY_INTERVAL_MS);

const scheduler = new SchedulerEngine(db, (members, action) => applyToMembers(db, members, action as any));
scheduler.start();
