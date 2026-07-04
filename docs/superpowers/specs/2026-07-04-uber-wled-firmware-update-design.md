# uber-wled Firmware Update Design

This extends the base design in
[2026-07-04-uber-wled-design.md](2026-07-04-uber-wled-design.md) with
controller firmware update management: checking WLED's GitHub releases for
new versions, picking the correct release asset per controller, and pushing
an OTA update — solving the recurring problem where a controller's official
update path (the WLED iOS app) repeatedly grabs the wrong asset for its chip
variant/flash size.

## Scope

In scope:
- Checking installed vs. latest available WLED version per controller
- A "pin once" asset picker: the first time you update a given controller,
  you're shown the release assets matching its detected chip family and pick
  the correct one; that choice is remembered for all future updates to that
  controller
- Pushing the update to the device via WLED's own OTA HTTP upload
- Caching GitHub's release list to avoid hitting its unauthenticated rate
  limit on every dashboard load

Out of scope: unattended/scheduled automatic updates (every update is a
manual, explicit, user-confirmed action — an OTA push that goes wrong can
brick a device, so this is never automated), rollback/downgrade tooling
beyond re-running an update with an older cached release, and updating
anything other than the main WLED firmware (no filesystem/LittleFS image
management).

## Data Model

### `Controller` (extends the base design)

Adds:
```
pinnedAssetPattern: string | null   // e.g. "ESP02" — the confirmed asset token for this controller
```

### `WledRelease` (new — a cache table, not a data model users edit directly)

```
tag: string              // e.g. "v0.15.0"
publishedAt: string
assets: { name: string; downloadUrl: string }[]
fetchedAt: string        // when this cache row was written
```

Only the single most-recently-fetched row set is kept meaningfully current;
older rows are harmless and simply superseded. Refetched at most every 6
hours automatically, or on-demand via a manual refresh action.

## Version & Asset Detection

1. `getInfo(host)` (already in the WLED client) returns `arch` (e.g.
   `esp8266`, `esp32`, `esp32s3`, `esp32c3`) and `ver` (installed version).
2. Candidate release assets are filtered by matching the release asset
   filename against the controller's `arch` (case-insensitive substring
   match against known chip-family tokens: `ESP8266`/`ESP01`/`ESP02` for
   `esp8266`; `ESP32`, but narrowed to `ESP32-S2`/`ESP32-S3`/`ESP32-C3`
   variants when `arch` reports that specific variant rather than plain
   `esp32`). This still commonly yields multiple candidates for `esp8266`
   boards, because WLED ships multiple flash-size variants there — that
   ambiguity is exactly what the pinning step resolves.

## Pin-Once Flow

1. `GET /api/controllers/:id/firmware` returns:
   ```
   { installedVersion, latestTag, updateAvailable: boolean,
     pinnedAssetPattern: string | null,
     candidateAssets: { name: string; downloadUrl: string }[] }
   ```
   `candidateAssets` is populated only when `pinnedAssetPattern` is `null`
   (first time) or when nothing in the current release matches the pinned
   pattern (the pin stops working — e.g. a variant was renamed upstream —
   surfaced as a warning rather than silently falling back to a guess).
2. The UI shows the candidates (filename + a short human label derived from
   it) for the user to pick, the first time.
3. `POST /api/controllers/:id/firmware/pin` with `{ assetPattern: string }`
   stores the chosen token (the asset filename with the `WLED_<version>_`
   prefix and `.bin` suffix stripped, e.g. `ESP02`) on the controller. Every
   future release is matched against this exact token going forward — no
   re-prompting.
4. `POST /api/controllers/:id/firmware/update` resolves the pinned pattern
   against the latest cached release, downloads that asset, and uploads it
   to the device.

## OTA Push

WLED exposes a manual firmware upload at `POST http://<host>/update`
(multipart form upload — the same endpoint its own web UI's "Manual OTA
Update" page uses). The exact multipart field name needs to be confirmed
against the WLED firmware source (`wled00/data/update.htm` /
`wled00/set.cpp`) at implementation time rather than assumed here; the
implementing task must verify this against a real device or the WLED source
before considering the upload code complete, since guessing wrong here is a
bricking risk, not just a bug.

After upload:
1. The device reboots itself (standard ESP OTA behavior).
2. uber-wled polls `getInfo(host)` after a short delay (with a bounded
   number of retries, since the device is rebooting and briefly
   unreachable) and compares the reported `ver` against the release tag
   that was pushed.
3. Match → update recorded as successful. Mismatch or continued
   unreachability after the retry window → surfaced as a failure requiring
   manual verification; uber-wled does not retry the OTA push itself.

## Error Handling

- GitHub API failures (rate-limited, unreachable) fall back to the last
  successfully cached release list with its `fetchedAt` shown, rather than
  blocking the update-check UI entirely.
- A download failure (asset unreachable) or upload failure (device
  unreachable/rejects the upload) is surfaced immediately and does not
  retry automatically — consistent with the base design's rule that
  device-config-changing writes aren't auto-retried, and doubly so here
  since a failed OTA mid-flash can brick the device.
- If a controller's pinned pattern no longer matches any asset in the
  latest release (upstream renamed a variant), uber-wled surfaces this as
  "pin needs review" rather than silently guessing a replacement.

## Testing

- Unit tests: chip-arch-to-asset-token filtering logic, pinned-pattern
  resolution against a release's asset list (including the "pin no longer
  matches" case).
- Integration tests: release-list fetch/cache route against a mocked GitHub
  API response (including a rate-limited/failed fetch falling back to
  cache); the pin and update-check routes against a mocked WLED `/json/info`
  response.
- No hardware-in-the-loop testing of the actual OTA upload — that remains a
  manual verification step against a real controller, called out explicitly
  since it's the highest-risk part of this feature.
