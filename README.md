# uber-wled

A self-hosted, LAN-only web app that acts as a unified controller for
multiple [WLED](https://kno.wled.ge/) devices around a house. One dashboard
instead of per-device WLED web UIs — a visual floorplan of where every light
run physically is, multi-select control across controllers, grouping,
themes, and scheduling (including a holiday/custom-event calendar).

Full design rationale lives in [docs/superpowers/specs/](docs/superpowers/specs/);
the implementation plan lives in [docs/superpowers/plans/](docs/superpowers/plans/).

## Status

Actively being built. Currently working:

- Controller management: add a WLED controller manually by name + IP, list, remove
- Docker deployment (single container, SQLite persistence on a mounted volume)

Not yet built (see the plans above for what's coming): mDNS auto-discovery,
the floorplan layout editor, segment editing/recommendation, groups, themes,
multi-select control, the scheduling engine (weekly schedules + holiday
calendar + custom events + WLED-schedule import), and firmware update
management.

## Architecture

- **Backend**: Node.js + TypeScript, Express (`server/`). Talks to WLED
  devices over their local JSON API. SQLite for persistence.
- **Frontend**: React + Vite SPA (`client/`), served by the backend in
  production.
- **Deployment**: one Docker image (multi-stage build), one
  `docker-compose.yml`. `network_mode: host` so the app can eventually reach
  WLED devices via mDNS discovery — this means the container binds directly
  to a port on the host, not a Docker-managed published port.
- No auth, no HTTPS, no cloud dependency — this is a LAN-only tool.

## Local development

Requires Node 20+.

```bash
# Backend — runs on :3000 by default, auto-reloads on save
cd server
npm install
npm run dev

# Frontend — Vite dev server, proxies API calls to the backend
cd client
npm install
npm run dev
```

Run each test suite from its own directory:

```bash
cd server && npm test
cd client && npm test
```

## Running the whole app locally via Docker

```bash
cp .env.example .env   # adjust PORT if 8081 is taken on your machine
docker compose up --build
```

The app will be reachable at `http://localhost:<PORT>` (default `8081`).
SQLite data and uploaded floorplan images persist in `./data/`, which is
gitignored and mounted into the container — nothing personal (your home
layout, controller IPs, etc.) is ever committed to this repo.

## Deployment

This repo is deployed to a home server via: push to GitHub, then on the
target host, `git clone`/`git pull` into `~/docker/uber-wled/` and run
`docker compose up -d --build` from there. The compose file uses
`network_mode: host`, so pick a `PORT` (via a local `.env` file, not
committed) that isn't already taken by another service on that host.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8081` | Port the app binds to (host networking — this is the actual port on the machine) |
| `DB_PATH` | `/app/data/uber-wled.db` (container) | SQLite database file location |

## Adding a controller

From the dashboard, enter a name and the controller's IP address (or
hostname) and click "Add controller." (Auto-discovery via mDNS is planned
but not yet implemented — for now, every controller is added manually.)
