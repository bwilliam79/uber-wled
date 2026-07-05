# uber-wled

A self-hosted, LAN-only web app that acts as a unified controller for
multiple [WLED](https://kno.wled.ge/) devices around a house. One app with a
left-sidebar layout instead of per-device WLED web UIs — a visual canvas of
where every light strip physically is (drawn by you, no floorplan image
needed), multi-select control right on that canvas, grouping, themes,
scheduling with a real month calendar, and firmware update management.

Full design rationale lives in [docs/superpowers/specs/](docs/superpowers/specs/);
the implementation plans live in [docs/superpowers/plans/](docs/superpowers/plans/).

## Status

Working end-to-end against real WLED hardware. The app is organized as a
left-sidebar shell with eight sections — **Home, Layout, Controllers,
Groups, Themes, Schedule, Firmware, Settings** — opening on Home by default.

- **Home**: the everyday control surface and default screen. One tile per
  Group (room or scene) plus one per ungrouped controller, each with live
  on/off + brightness, power/brightness controls, and a single dropdown
  combining raw WLED effects (imported live, applied instantly with no
  Theme needed) and your saved Themes.
- **Layout canvas**: an imageless dark canvas of your house. Draw
  each LED strip as a multi-point path (traces corners/rooflines), drag to
  arrange, and drop loose room labels for grouping. Each strip binds to a
  real controller + WLED segment and renders in its **live color** (polled
  every 5s, muted when off, greyed when its controller is offline). The
  canvas doubles as the control surface: click or box-select strips and a
  docked panel applies power / brightness / preset / theme immediately.
- **Controller discovery**: automatic via mDNS (interval configurable in
  Settings) merged with manually-added controllers by IP/hostname;
  auto-discovered controllers that disappear are marked stale, never
  silently deleted.
- **Segments**: read live from each controller's native WLED segments;
  editable/creatable through the app, written back to the device.
- **Segment split recommendations**: drawing two strips onto the same
  physical WLED segment surfaces a suggestion to split it on the device.
- **Groups**: named sets of controller+segment members, editable from the
  Groups section — the target for control actions, schedules, and calendar
  events.
- **Control**: apply power, brightness, a WLED preset, or a custom theme to
  a whole selection in one action; per-controller failures are isolated and
  retried once, never fail the whole batch.
- **Themes**: custom effect/palette/color/brightness combos, independent of
  any device's own presets. Effect and palette are picked from named
  dropdowns imported live from a controller (`/json/eff` and `/json/pal`),
  not typed in as raw WLED IDs; the form is disabled with an explanatory
  message until a controller responds.
- **Schedule (month calendar)**: a real month-grid calendar is the hero of
  the Schedule section — holidays and custom events show as chips on their
  dates, a side panel shows the selected day's detail plus your weekly
  recurring schedules. Schedules are weekly (day-of-week + time) or
  cron-based, targeting a Group.
- **Calendar**: a pre-seeded US holiday list (federal + common decorating
  occasions), all disabled by default until you assign a theme and enable
  them, plus custom one-off or yearly-recurring events (birthdays,
  anniversaries, specific dates). An enabled calendar event overrides
  overlapping weekly/cron schedules for that day; a holiday and a custom
  event can't silently collide on the same date (rejected with a clear
  conflict error instead).
- **Firmware updates**: the Firmware section lists every controller with its
  installed vs. latest **stable** version (pre-release/nightly builds are
  filtered out by default; opt in via a Settings toggle). The first update
  for a given controller shows you the matching release-asset candidates to
  pick from (this is the "pin once" step that solves picking the wrong
  binary for boards with unusual flash-size variants), then remembers your
  choice for every future update on that controller. Pushes the update via
  WLED's own OTA HTTP endpoint and polls for the new version afterward.
  Offline controllers show "Controller offline" rather than hanging.
- **Settings**: global configuration that used to have no home — include
  pre-release firmware builds (default off), home latitude/longitude for
  sunset/sunrise-relative scheduling, the discovery re-scan interval, the
  controller status poll interval, a manual "Re-scan now", and the default
  "disable on device" for WLED schedule import.
- **Controller status polling**: a background job reads each controller's
  current info + state (name, firmware version, power/brightness/effect,
  segments) on an interval (configurable in Settings, default 5 minutes) and
  caches the latest snapshot per controller, exposed via
  `GET /api/controllers/:id/status`. This runs independently of — and is not
  a replacement for — the Layout page's own 5-second live-color polling used
  while actively editing the canvas; it exists so other parts of the UI can
  read a controller's current config cheaply without a live device round
  trip.
- **WLED schedule import**: one-time best-effort import of a controller's
  existing time-based presets into an uber-wled weekly schedule, with an
  option to clear the schedule on the device afterward.
- **Preview before saving**: schedule/calendar-event editors preview a theme
  live against the real lights, then revert to the exact prior state on
  approve or discard.

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
cd server && npm test   # 25 files / 127 tests
cd client && npm test   # 19 files / 56 tests
```

## Running the whole app locally via Docker

```bash
cp .env.example .env   # adjust PORT if 8081 is taken on your machine
docker compose up --build
```

The app will be reachable at `http://localhost:<PORT>` (default `8081`).
SQLite data persists in `./data/`, which is gitignored and mounted into the
container — nothing personal (your home layout, controller IPs, etc.) is
ever committed to this repo.

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

- **Home**: the default screen. One tile per Group (a Group doubles as a
  room or scene for this purpose) plus one tile per controller not yet in
  any Group. Each tile shows live on/off + brightness (or "Mixed" if its
  members disagree, or an offline badge if a member is unreachable) and lets
  you toggle power, adjust brightness, or apply either a raw WLED effect
  (instant, no setup) or a saved Theme from one combined dropdown — all
  without leaving the page.
- **Layout**: the spatial setup screen. Click "Draw strip" to trace a strip on the
  canvas and bind it to a controller + segment; drag strips and room labels
  to arrange. Click or box-select strips to control them from the docked
  panel. Strips render in their live color. This screen is expected to take
  more iteration than the rest to feel right — freehand path drawing is
  inherently harder to nail on the first pass than a CRUD screen.
- **Controllers**: discovered automatically (interval set in Settings), or
  add one manually by name + IP/hostname. A stale badge means a
  previously-seen discovered controller hasn't responded recently — it's
  kept, not deleted, in case it comes back online.
- **Groups**: create a group, then add members (pick a controller + a WLED
  segment id) — a group only actually does anything once it has members.
- **Themes**: build a custom effect/palette/color/brightness combo, picking
  the effect and palette by name from a dropdown (imported from the first
  reachable controller); these become selectable anywhere a WLED preset
  would be (control panel, schedules, calendar events).
- **Schedule**: the month calendar is the hero. Click a day to see its
  detail; "+ Event" adds a custom calendar event; weekly recurring schedules
  live in the side panel. Preview a theme live before saving —
  approve/discard reverts the lights to exactly how they were.
- **Firmware**: each controller shows installed vs. latest stable version.
  The first update prompts you to pick the correct release asset for your
  board; every update after that reuses that choice automatically.
- **Settings**: pre-release firmware toggle, home lat/long, discovery
  interval + "Re-scan now", and the schedule-import default.

## Known limitations / follow-up items

- The Layout canvas is the screen most likely to need hands-on refinement —
  freehand path drawing and spatial arrangement take iteration to feel right.
- The WLED OTA upload's exact multipart field name is implemented against
  the best available documentation but should be verified against a real
  device before relying on it for a controller you can't easily re-flash by
  hand if it's wrong — see the TODO in `server/src/firmware/otaPush.ts`.
- Segment split recommendations require a live call to the affected
  controller when you draw a strip (a deliberate trade-off to make the
  feature actually work) — drawing a strip while its controller is offline
  still succeeds, it just skips the recommendation check for that request.
