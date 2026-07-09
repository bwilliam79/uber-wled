import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Read directly from package.json at runtime rather than a static JSON
// import — resolveJsonModule + NodeNext would need package.json inside
// tsconfig's rootDir (src/) to map cleanly into dist/, but package.json
// lives one level up at the server package root. The Dockerfile copies
// package.json to /app/package.json alongside /app/dist, so from a
// top-level file here (dist/appVersion.js) it's always exactly one
// directory up, regardless of which submodule imports this.
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };

export const CURRENT_APP_VERSION: string = pkg.version;
