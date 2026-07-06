# uber-wled

A self-hosted, LAN-only control plane for every [WLED](https://kno.wled.ge/)
device in the house. One app replaces the per-device WLED web UIs and the
WLED phone app — multi-controller-first: select any mix of rooms, devices,
or segments and apply the complete WLED control surface (colors, effects,
palettes, presets, nightlight) to all of them at once. Fan-out writes carry
WLED's per-request no-notify flag (`udpn: { nn: true }`) so the app never
fights an existing UDP sync group.

Full design rationale lives in [docs/superpowers/specs/](docs/superpowers/specs/);
implementation plans live in [docs/superpowers/plans/](docs/superpowers/plans/).

## The seven sections

The app is a responsive shell — left sidebar on desktop, bottom navigation
bar on phones — with seven sections, opening on Home:

1. **Home** — one tile per room (a room *is* a group) plus one per ungrouped
   controller. Tiles show live power/brightness with an ambient glow derived
   from the lights' actual current colors (muted when off, grey when
   offline). Quick power toggle and brightness slider on the tile; tapping a
   tile opens the Control surface for it. Long-press (touch) or
   hover-checkbox (desktop) multi-selects tiles into one Control session.
   Edit mode creates/renames/deletes rooms, assigns controller+segment
   members inline, and drag-reorders tiles.
2. **Layout** — an imageless canvas of the house. Draw each strip as a
   multi-point path (click to place vertices, Enter to finish, Esc to
   cancel, Shift for 45° angles, optional grid snap), drag strips or
   individual vertices to arrange, wheel/pinch zoom and pan, "fit all".
   Strips render in their real live color from the live stream. Click or
   marquee-select strips to open the Control surface for exactly those
   (controller, segment) targets.
3. **Devices** — one card per controller: name, host, firmware chip, live
   WiFi signal, FPS, power, uptime, stale/offline and update-available
   badges. The detail page has five tabs: **Info** (identity, network,
   uptime, heap, filesystem, LED counts, usermods, an embedded `/liveview`
   peek of the actual output, reboot with confirm, open-native-UI),
   **Segments** (full editor: bounds validated against the LED count,
   grouping, spacing, offset, reverse, mirror, name, per-segment
   on/brightness, create/delete — applies live), **Presets** (device presets
   and playlists: apply, delete with confirm, save-current-state with
   include-brightness and save-bounds options), **Config** (below), and
   **Update** (the per-controller firmware pin/OTA flow).
4. **Themes** — custom effect/palette/color/brightness combos independent of
   any device's presets. The form reads the per-controller capability cache:
   effect search with 2D/audio badges, palette picker with real gradient
   previews, color slots, brightness. Themes are applicable from the Control
   surface, schedules, and calendar events.
5. **Schedule** — a real month calendar. Holidays and custom events sit as
   chips on their dates; a side panel shows the selected day plus weekly and
   cron recurring schedules targeting a room. An enabled calendar event
   overrides overlapping schedules for that day. Editors preview a theme
   live against the real lights and revert exactly on approve or discard.
6. **Firmware** — fleet view of installed vs. latest stable version
   (pre-releases opt-in via Settings). First update per controller pins the
   correct release asset; later updates reuse the pin. OTA push via WLED's
   own endpoint, with post-update version polling.
7. **Settings** — pre-release firmware toggle, home latitude/longitude for
   sunrise/sunset schedules, discovery re-scan interval + "Re-scan now",
   background status poll interval, live poll interval (seconds) for the
   streaming sessions, and the WLED schedule-import default.

## The Control surface

One shared component, three entry points (Home tiles, Layout selection,
Devices "Control" button). Desktop: a ~480px right slide-over. Phone: a
full-height draggable bottom sheet.

- A selection is a list of targets — whole controllers or
  (controller, segment) pairs; room targets expand to their members. Header
  shows removable target chips.
- Always visible: master power, master brightness, transition duration,
  nightlight popover. Anywhere the targets disagree, a "Mixed" chip shows
  and the control is write-only until you set a value.
- **Colors** tab: color wheel, per-effect color slots, hex input, RGB
  sliders, white-channel slider on RGBW targets, CCT + kelvin presets,
  recent colors.
- **Effects** tab: searchable list of every effect with 2D/audio badges;
  selecting one reveals its real controls (speed/intensity/custom sliders,
  checkbox options) with the labels the firmware itself reports.
- **Palettes** tab: searchable list with true gradient previews; randomized
  and color-slot palettes render sensibly.
- **Presets** tab: saved Themes always; device presets/playlists when the
  selection is a single controller.
- Effects and palettes are resolved **by name per device**, so mixed-firmware
  fleets apply the same-named effect even when ids differ; a device lacking
  the name reports a per-target failure without failing the batch. Every
  target is written in isolation with one retry; results surface as a toast
  with expandable per-target details.

## Live streaming

While Home, Layout, or the Control surface is open, the client subscribes to
`GET /api/live?controllers=...` (Server-Sent Events). The server keeps one
refcounted fast-poll session per watched controller (default every 2s,
configurable in Settings) and stops it when the last subscriber disconnects.
The separate background status poller (default every 5 minutes) still
provides glanceable data when nobody is watching.

## Device config parity + guardrails

The Devices → Config tab edits the device's full `cfg.json`: structured
forms for Identity, LED & hardware outputs (GPIO pin, type, length, color
order, reverse, skip, power limits, auto-white), WiFi (SSID, write-only
password, static IP, AP fallback), sync interfaces, time/NTP, and LED
preferences — plus a raw JSON editor for everything else (usermods
included). Guardrails, because full parity includes footguns:

- Every save first runs a server-side dry-run and shows a
  **diff-and-confirm modal** (old → new per changed path) before applying.
- WiFi and GPIO changes get an extra explicit warning naming the
  strand-the-device risk.
- Saves that need a reboot surface a "Reboot now" follow-up instead of
  rebooting silently.

## Architecture

- **Backend**: Node.js + TypeScript, Express (`server/`). Talks to WLED
  devices over their local JSON API; per-controller capability cache
  (effects, palettes, effect metadata, palette previews) refreshed when a
  device's firmware build changes. SQLite for persistence (schema in
  `server/src/db/schema.ts`).
- **Frontend**: React + Vite SPA (`client/`), served by the backend in
  production. Design system is plain CSS tokens + a small component kit —
  no UI framework; fonts self-hosted (no CDN calls, ever).
- **Deployment**: one Docker image (multi-stage build), one
  `docker-compose.yml`. `network_mode: host` so mDNS discovery can see WLED
  devices on the LAN — the container binds directly to a host port.
- **Security posture**: no auth, no HTTPS, no cloud dependency — a
  deliberate LAN-only design relying on the home network's perimeter.

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
cd server && npm test   # 41 files / 280 tests
cd client && npm test   # 72 files / 486 tests
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

1. **Add controllers** — Devices fills itself via mDNS discovery (interval
   in Settings), or add one manually by name + IP/hostname. A stale badge
   means a discovered controller stopped responding; it's kept, not deleted.
2. **Make rooms** — on Home, hit Edit, create a room, pick its
   controller + segment members, drag tiles into the order you want.
3. **Control** — tap a tile (or select several) and the Control surface
   opens: power, brightness, colors, effects with their real per-effect
   controls, palettes with previews, presets. Same surface from Layout
   selections and the Devices list.
4. **Draw the house** — on Layout, draw each strip as a path where it
   physically runs, bind it to a controller + segment, and drop room
   labels. Strips light up in their true live colors.
5. **Save Themes** — build effect/palette/color/brightness combos; apply
   them anywhere, schedule them, or hang them on holidays.
6. **Schedule** — weekly/cron schedules and calendar events (pre-seeded US
   holidays + custom dates) target a room; sunset/sunrise offsets use the
   home location from Settings; preview shows the real lights before you
   commit, then restores them exactly.
7. **Stay current** — Firmware shows installed vs. latest stable per
   controller; pin the right release asset once, then update in one click
   (also per-device under Devices → Update).

## Known limitations / follow-up items

- Playlist editing is out of scope (apply/delete only); no custom palette
  builder (built-ins browse only, by design).
- The WLED OTA upload's exact multipart field name is implemented against
  the best available documentation — verify against a device you can
  re-flash by hand before relying on it (see
  `server/src/firmware/otaPush.ts`).
- UDP-sync *replacement* (the long-term north star) is not built; the app
  coexists with sync via per-request no-notify writes.
