# uber-wled

A self-hosted, LAN-only web app that acts as a unified controller for
multiple [WLED](https://kno.wled.ge/) devices around a house. One dashboard
instead of per-device WLED web UIs — a visual floorplan of where every light
run physically is, multi-select control across controllers, grouping,
themes, scheduling (weekly + a holiday/custom-event calendar), and firmware
update management.

Full design rationale lives in [docs/superpowers/specs/](docs/superpowers/specs/);
the implementation plan lives in [docs/superpowers/plans/](docs/superpowers/plans/).

## Status

Feature-complete for the initial design. Working end-to-end against real
WLED hardware:

- **Controller discovery**: automatic via mDNS (re-scanned every 5 minutes)
  merged with manually-added controllers by IP/hostname; auto-discovered
  controllers that disappear are marked stale, never silently deleted.
- **Segments**: read live from each controller's native WLED segments;
  editable/creatable through the app, written back to the device.
- **Floorplan editor**: upload a floorplan image, crop/rotate/zoom it, draw
  each light segment as a multi-point path tracing its real physical run.
- **Segment split recommendations**: drawing two placements onto the same
  physical WLED segment surfaces a suggestion to split it on the device.
- **Groups**: named sets of segments/controllers (spatial or logical),
  editable from the Groups panel — used as the target for control actions,
  schedules, and calendar events.
- **Control**: multi-select segments/controllers and apply power,
  brightness, a WLED preset, or a custom theme in one action; per-controller
  failures are isolated and retried once, never fail the whole batch.
- **Themes**: custom effect/palette/color/brightness combos, independent of
  any device's own presets.
- **Scheduling**: weekly (day-of-week + time) or cron-based schedules,
  targeting a Group.
- **Calendar**: a pre-seeded US holiday list (federal + common decorating
  occasions), all disabled by default until you assign a theme and enable
  them, plus custom one-off or yearly-recurring events (birthdays,
  anniversaries, specific dates). An enabled calendar event overrides
  overlapping weekly/cron schedules for that day; a holiday and a custom
  event can't silently collide on the same date (rejected with a clear
  conflict error instead).
- **Preview before saving**: schedule/calendar-event editors can preview a
  theme live against the real lights, then revert to the exact prior state
  on approve or discard.
- **WLED schedule import**: one-time best-effort import of a controller's
  existing time-based presets into an uber-wled weekly schedule, with an
  option to clear the schedule on the device afterward.
- **Firmware updates**: checks WLED's GitHub releases against each
  controller's installed version and chip architecture; the first update
  for a given controller shows you the matching release-asset candidates to
  pick from (this is the "pin once" step that solves picking the wrong
  binary for boards with unusual flash-size variants), then remembers your
  choice for every future update on that controller. Pushes the update via
  WLED's own OTA HTTP endpoint and polls for the new version afterward.

## Architecture

- **Backend**: Node.js + TypeScript, Express (`server/`). Talks to WLED
  devices over their local JSON API. SQLite for persistence (schema in
  `server/src/db/schema.ts`).
- **Frontend**: React + Vite SPA (`client/`), served by the backend in
  production.
- **Deployment**: one Docker image (multi-stage build), one
  `docker-compose.yml`. `network_mode: host` so mDNS discovery can see WLED
  devices on the LAN — this means the container binds directly to a port on
  the host, not a Docker-managed published port.
- **Security posture**: no auth, no HTTPS, no cloud dependency — this is a
  deliberate LAN-only design that relies on the home network's own
  perimeter. Controller hostnames/IPs are format-validated (rejecting
  URL-like or malformed input) but not restricted to private ranges, since
  real WLED controllers live at ordinary LAN addresses.

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
cd server && npm test   # 24 files / 124 tests
cd client && npm test   # 10 files / 27 tests
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

## Using the app

- **Controllers**: discovered automatically every 5 minutes, or add one
  manually by name + IP/hostname. A stale badge means a previously-seen
  discovered controller hasn't responded recently — it's kept, not deleted,
  in case it comes back online.
- **Floorplans**: upload an image, then open it to crop/rotate/zoom and
  start drawing segments. This part of the app is expected to take more
  iteration than the rest to feel right — freehand path drawing is
  inherently harder to nail on the first pass than a CRUD screen.
- **Groups**: create a group, then add members (pick a controller + a WLED
  segment id) from the Groups panel — a group only actually does anything
  once it has members.
- **Themes**: build a custom effect/palette/color/brightness combo from the
  Themes panel; these become selectable anywhere a WLED preset would be
  (control panel, schedules, calendar events).
- **Schedules & calendar**: build a weekly schedule or a custom calendar
  event from the Schedule manager; preview the look live before saving, and
  approve/discard reverts the lights to exactly how they were.
- **Firmware**: each controller in the list shows installed vs. latest WLED
  version. The first update prompts you to pick the correct release asset
  for your board; every update after that for the same controller reuses
  that choice automatically.

## Known limitations / follow-up items

- The floorplan editor's crop/rotate/zoom is stored as metadata but the
  actual client-side cropping UI is a fast-follow, not yet built.
- The WLED OTA upload's exact multipart field name is implemented against
  the best available documentation but should be verified against a real
  device before relying on it for a controller you can't easily re-flash by
  hand if it's wrong — see the TODO in `server/src/firmware/otaPush.ts`.
- Segment split recommendations require a live call to the affected
  controller at placement-creation time (a deliberate trade-off to make the
  feature actually work, rather than the originally-planned "always
  instant, sometimes wrong" version) — creating a placement while its
  controller is offline still succeeds, it just skips the recommendation
  check for that request.
