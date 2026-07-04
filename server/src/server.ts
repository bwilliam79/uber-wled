import { createApp } from './app.js';
import { createDb } from './db/client.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const DB_PATH = process.env.DB_PATH ?? './data/uber-wled.db';

const db = createDb(DB_PATH);
const app = createApp(db);
app.listen(PORT, () => {
  console.log(`uber-wled server listening on port ${PORT}`);
});
