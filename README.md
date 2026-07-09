# uber-wled

A self-hosted, LAN-only control plane for every [WLED](https://kno.wled.ge/)
device on your network. One app replaces the per-device WLED web UIs and the
WLED phone app — multi-controller-first: select any mix of rooms, devices,
or segments and apply the complete WLED control surface (colors, effects,
palettes, presets, nightlight) to all of them at once. Fan-out writes carry
WLED's per-request no-notify flag (`udpn: { nn: true }`) so the app never
fights an existing UDP sync group.

Full design rationale lives in [docs/superpowers/specs/](docs/superpowers/specs/);
implementation plans live in [docs/superpowers/plans/](docs/superpowers/plans/).

## Quick start

Runs as a single Docker container.

```bash
git clone https://github.com/bwilliam79/uber-wled.git && cd uber-wled
cp .env.example .env      # pick a PORT if 8081 is already taken
docker compose up -d --build
```

Open `http://localhost:<PORT>` (default `8081`). The container uses
`network_mode: host` — binding directly to a host port — so it can discover
WLED devices on your LAN via mDNS. SQLite data persists in `./data/`
(gitignored, mounted into the container) — nothing personal (controller
IPs, rooms, schedules) is ever committed to the repo.

**On a home server:** `git clone`/`git pull` into `~/docker/uber-wled/` and
run `docker compose up -d --build` there; pick a free `PORT` in a local
`.env`. **To update later:** `git pull && docker compose up -d --build`.

(Node 20+ is only needed for local development — see below.)

## The sections

The app is a responsive shell — left sidebar on desktop, bottom navigation
bar on phones — opening on Home:

1. **Home** — one tile per room (a room *is* a group) plus one per ungrouped
   controller. Tiles show live power/brightness with a small status dot
   (green on, red off, amber mixed, grey offline/unknown) plus a small
   live-output strip with one swatch per segment for an at-a-glance read of
   exactly what's showing. Quick power toggle and
   brightness slider on the tile; tapping a tile opens the Control surface
   for it. Long-press (touch) or
   hover-checkbox (desktop) multi-selects tiles into one Control session.
   Edit mode creates/renames/deletes rooms, assigns controller+segment
   members inline, and drag-reorders tiles.
2. **Devices** — one card per controller: name, host, firmware chip, live
   WiFi signal, FPS, power, uptime, stale/offline and update-available
   badges, plus a live-output strip (one swatch per segment, driven by the
   live stream) so a card shows what its lights are actually doing without
   opening it. The detail page has five tabs: **Info** (the live-output
   strip shown automatically, identity, network, uptime, heap, filesystem,
   LED counts, usermods, an opt-in "Open native live view" embed of the
   device's own `/liveview` page, reboot with confirm, open-native-UI),
   **Segments** (full editor: bounds validated against the LED count,
   grouping, spacing, offset, reverse, mirror, name, per-segment
   on/brightness, create/delete — applies live), **Presets** (device presets
   and playlists: apply, delete with confirm, save-current-state with
   include-brightness and save-bounds options), **Config** (below), and
   **Update** (the per-controller firmware pin/OTA flow).
3. **Themes** — custom effect/palette/color/brightness combos independent of
   any device's presets. The form reads the per-controller capability cache:
   effect search with 2D/audio badges, palette picker with real gradient
   previews, color slots, brightness. Existing themes can be edited in place
   (Edit on any row prefills the form and saves back over the same theme) or
   removed, the whole set can be exported/imported as JSON, and a
   controller's own WLED device presets can be imported as themes — with
   dedup: presets already imported (same name + settings) are flagged, and a
   name that clashes with a different existing theme prompts to overwrite or
   import under a new name. Themes are
   applicable from the Control surface (where the tab is labeled "Themes" to
   match this section — WLED device presets remain a separate, clearly
   labeled subsection there), schedules, and calendar events.
4. **Schedule** — two tabs. **Calendar** is a full-width month grid for
   one-offs (holidays, birthdays, special events): events sit as chips on
   their dates; clicking a day opens an overlay to view/edit that day's
   events, and clicking an empty day (marked with a +) opens the same dialog
   to create a custom entry prefilled with that date. A configured holiday
   (a theme is set and it's enabled) shows a green dot; an unconfigured
   placeholder is drawn as a dashed chip, so it's clear at a glance which
   holidays are actually set up. **Weekly** holds the weekly and cron
   recurring schedules, each targeting either
   a Room group or a set of specific controllers directly. An enabled calendar event overrides overlapping
   schedules for that day. Every schedule and event shows what it's actually
   assigned to and can be edited in place (name, target, theme, time; the
   date too, unless it's a computed rule like "4th Thursday of November"), not just
   toggled or removed. A calendar event's trigger can be a fixed clock time or
   sunset/sunrise with a ± minute offset, and it can carry an independent OFF
   trigger (also fixed/sunset/sunrise) that powers the target off — e.g. hang
   holiday lights on at sunset and off at a set time, or off at sunrise.
   Sunset/sunrise use the home location from Settings. Editors preview a theme
   live against the real lights and revert exactly on approve or discard.
5. **Sync** — user-managed sync groups: pick any set of controllers and
   activate WLED's own native real-time UDP sync across exactly them, no
   hand-editing each device's Sync Interfaces settings page. See "Sync
   groups" below for how this actually works on the wire.
6. **Firmware** — fleet view of installed vs. latest stable version
   (pre-releases opt-in via Settings) per controller, with a one-click
   Update button (and an "Update All" button fleet-wide) once a device is
   pinned and a newer release exists, plus a gear icon into that device's
   own Update tab for first-time setup or re-pinning; detected hardware
   architecture and the asset picker itself live there rather than
   cluttering the fleet list. First update per controller requires a
   one-time asset pin before an OTA push is ever attempted, even when only
   one candidate exists, since a wrong-variant flash isn't reliably
   detectable as a clean failure after the fact — never auto-guessed or
   auto-retried. When a plain, unspecialized build is confidently
   identifiable (e.g. `ESP32` vs. `ESP32_HUB75`/`_Ethernet`/`_WROVER`), the
   picker pre-highlights it as the recommended pick; genuine ambiguity
   across fundamentally different hardware (e.g. `esp8266`'s flash-size
   variants) is never guessed at. Later updates reuse the pin with no
   re-prompting. OTA push via WLED's own endpoint, with post-update version
   polling.
7. **Settings** — pre-release firmware toggle, home latitude/longitude for
   sunrise/sunset schedules, discovery re-scan interval + "Re-scan now",
   background status poll interval, live poll interval (seconds) for the
   streaming sessions, and the WLED schedule-import default. Home
   latitude/longitude can still be typed directly, or filled in via
   "Look up an address" (geocoded via OpenStreetMap's Nominatim, proxied
   through the server so it can send Nominatim's required identifying
   User-Agent — the only outbound call this app makes besides checking for
   firmware updates). The browser's own on-device Geolocation API was
   deliberately left out: it requires HTTPS or localhost, which this
   LAN-only, plain-HTTP app never is, so it would always fail. Settings also
   has **Backup & restore**: download a full-config snapshot
   (`uber-wled-backup.json` — controllers, rooms, sync groups, themes,
   schedules, calendar events, room labels, and settings), or restore one
   after a rebuild. The restore preserves every record's id so cross-references
   survive (a rebuilt instance re-discovers controllers under new ids, so
   the backup brings the original controller ids back too, keeping schedules
   and rooms pointing at the right devices); it replaces everything and is
   gated behind a confirm. Themes (Themes page) and schedules + calendar
   events (Schedule page) also have their own lighter **Export**/**Import**
   buttons for sharing or partial transfer — theme import appends under
   fresh ids; schedule import appends and skips any row whose referenced
   room/controller doesn't exist on the target instance.

The sidebar also passively checks GitHub for a newer **uber-wled** release
(the app itself, not device firmware) — the server reads `server/package.json`
off the tip of `main` via GitHub's raw-content CDN, caches it for six hours,
and compares it to the running version. When a newer version exists, the
version label under the logo turns into an "update available" link to the
repo. There is no in-place self-update: updating means `git pull` +
`docker compose up -d --build` on the host, as with any deploy.

## The Control surface

One shared component, two entry points (Home tiles and the Devices
"Control" button). Desktop: a ~760px right slide-over with a two-column
Colors tab and multi-column effect/palette/theme lists. Phone: a
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
- **Themes** tab: your saved Themes always; the device's own presets and
  playlists too when the selection is a single controller.
- Effects and palettes are resolved **by name per device**, so mixed-firmware
  fleets apply the same-named effect even when ids differ; a device lacking
  the name reports a per-target failure without failing the batch. Every
  target is written in isolation with one retry; results surface as a toast
  with expandable per-target details.

## Live streaming

While Home or the Control surface is open, the client subscribes to
`GET /api/live?controllers=...` (Server-Sent Events). The server keeps one
refcounted fast-poll session per watched controller (default every 2s,
configurable in Settings) and stops it when the last subscriber disconnects.
The separate background status poller (default every 5 minutes) still
provides glanceable data when nobody is watching.

The per-segment live-output swatches (Home tiles, Devices cards, Device Info
tab) additionally connect straight from the browser to each lit controller's
own `ws://<host>/ws` — WLED's native live-view protocol (the same channel the
official WLED app's "Peek" feature and the device's own `/liveview` page use).
Sending `{"lv":true}` gets a stream of binary frames with the device's real
current per-LED colors, which render as an actual gradient instead of the
flat, configured color slot — the only way to show what an animated effect
(Rainbow, Colorloop, a chase...) is really doing, since that never touches
`col[0]`. (`/json/live`, an unrelated HTTP polling endpoint, returns 501 on
this firmware — that's not what either live view relies on.)

## Sync groups

Distinct from a Home room (an organizational grouping with no bearing on
real-time playback): a sync group is a set of controllers wired
together via WLED's own native UDP sync (broadcast on LAN port 21324) so
their effects and colors play in lockstep, managed entirely through this
app instead of each device's own Sync Interfaces settings page.

WLED supports up to 8 independent sync "groups" on one LAN via a bitmask on
each device's `if.sync.send.grp` / `if.sync.recv.grp` config — one bit per
group, no built-in naming. Activating an app-level sync group claims one of
those 8 bits (tracked centrally so two active groups never collide),
enables broadcasting (`send.en: true`) on every member with that bit, and
configures each to receive brightness/color/effect/palette from the others
on it; deactivating reverts every member's `send.en` to `false` and frees
the bit. Membership can only change while a group is inactive — deactivate,
edit, reactivate. This coexists with the app's own fan-out writes: every
`applyControlPatch` write still carries `udpn: { nn: true }` so the app's
own multi-controller commands never double up on top of what an active
sync group already broadcasts to its members.

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
  deliberate LAN-only design relying on the home network's perimeter. The
  only outbound internet calls the server makes are narrow, named
  exceptions: checking GitHub for WLED firmware releases (periodic,
  cached — see Firmware) and, only if you click "Look up an address" in
  Settings, a one-off geocoding lookup against OpenStreetMap's Nominatim.
  The address lookup is opt-in and user-triggered only — it never runs
  automatically or in the background.

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
cd server && npm test   # 48 files / 373 tests
cd client && npm test   # 78 files / 605 tests
```

(Running the whole app via Docker and deploying to a home server are covered
in **Quick start** at the top.)

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
   controls, palettes with previews, themes. Same surface from the Devices
   list.
4. **Save Themes** — build effect/palette/color/brightness combos; edit or
   export them; apply them anywhere, schedule them, or hang them on holidays.
5. **Schedule** — weekly/cron schedules and calendar events (pre-seeded US
   holidays + custom dates) target either a Room group or a set of specific
   controllers directly; sunset/sunrise offsets use the home location from Settings;
   preview shows the real lights before you commit, then restores them
   exactly.
6. **Sync groups** — on Sync, create a group, pick its controllers, and hit
   Activate to wire them together on WLED's own real-time UDP sync; hit
   Deactivate to pull them apart. Rename anytime; membership only while
   inactive.
7. **Stay current** — Firmware shows installed vs. latest stable per
   controller; pin the right release asset once, then update in one click
   (also per-device under Devices → Update).
8. **Back up** — Settings → Back up configuration downloads a full snapshot
   you can restore after a rebuild (see Settings above).

## Known limitations / follow-up items

- Playlist editing is out of scope (apply/delete only); no custom palette
  builder (built-ins browse only, by design).
- Sync groups (see "Sync groups" above) manage WLED's own native UDP sync
  rather than replacing it with an app-level protocol — a controller can
  only be an active member of one sync group at a time (no combined-bitmask
  multi-membership), and up to 8 sync groups can be active simultaneously
  (WLED's own bitmask ceiling).
