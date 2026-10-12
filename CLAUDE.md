# CLAUDE.md

Guidance for working in this repository.

## What this is

**rsvp** is a self-hosted hardware reservation and testbed-inventory application. It combines hourly bookings, server/NIC claims, programmable-switch port maps, physical and management topology, VLAN inventory, Authentik OIDC, and one-way Nextcloud CalDAV sync. Deployment branding and infrastructure-specific values belong in `.env` or the persistent data directory, never in schema migrations. Current version **1.5.0** (kept in sync between `backend/Cargo.toml`, `backend/Cargo.lock`, `frontend/package.json`, and `frontend/package-lock.json`). Commits follow Conventional Commits.

## Architecture

```
Browser ──▶ nginx ──▶ rsvp container :3000 (axum: SPA + /api/v1) ──▶ SQLite (bind mount ${DATA_DIR:-./data})
                          │                                  │
                          └──▶ Authentik OIDC                └──▶ Nextcloud CalDAV (worker)
```

Single Docker image: 3-stage build (`node:22` frontend → `rust:1-bookworm` backend → `debian:bookworm-slim`), backend serves the built SPA via `ServeDir` with `index.html` fallback. Compose publishes `${HOST_PORT:-4343}:3000`, always uses `unituekn/rsvp:latest`, and accepts `OIDC_EXTRA_HOST` as a deployment override.

## Running the stack

Dev (backend `:3125`, frontend `:5173` with `/api` + `/swagger-ui` proxied):
```sh
cd backend && AUTH_DEV_MODE=1 cargo run
cd frontend && npm run dev
# login: http://localhost:5173/api/v1/auth/dev-login?name=alice&admin=true
```

Checks:
```sh
cd backend && cargo fmt --check && cargo clippy -- -D warnings && cargo test
cd frontend && npm run lint && npm run test && npm run build
```

OpenAPI pipeline (rerun after changing API types/handlers):
```sh
cd backend && cargo run --bin openapi-export > ../frontend/fixtures/openapi.json
cd frontend && npm run generate:api    # -> src/api/schema.ts
```

Deploy:
```sh
cp .env.example .env   # fill in
docker compose up -d
curl localhost:4343/api/v1/health
```

## Backend (`backend/`)

- **Stack:** axum 0.8 (Rust 2024), tokio, sqlx 0.9 (SQLite, runtime queries), tower-http 0.7 (`cors`, `trace`, `fs`), tower-cookies, openidconnect 4, reqwest 0.13 (rustls), utoipa 5 + utoipa-swagger-ui 9 (vendored), thiserror 2. Two binaries: `rsvp` (server) and `openapi-export`.
- **Entry:** `src/main.rs` → `Config::from_env()` (`src/config.rs`) → `db::connect` (runs the idempotent public schema baseline from `migrations/`) → `build_app` in `src/lib.rs`, plus `tokio::spawn(caldav::run_worker(state))`.
- **`AppState`** (`src/lib.rs`): `{ config, db: SqlitePool, http: reqwest::Client, caldav_notify: Arc<Notify>, caldav_last_run: Arc<AtomicI64>, pending_oauth: Arc<Mutex<PendingOAuthMap>> }`. Module-per-feature, each exposing `router()` merged under `/api/v1`: `auth`, `devices`, `ports`, `bookings`, `settings`, `caldav`; `openapi` mounts Swagger UI at root.
- **Errors:** `src/error.rs` — thiserror `ApiError`/`ApiResult`, JSON `{"error": ...}`, 500s masked.
- **Auth** (`src/auth/mod.rs`): openidconnect Authorization Code + PKCE + nonce; pending state kept in-memory (`PendingOAuthMap`, 600s TTL, keyed by CSRF state). Sessions: cookie `rsvp_session` = random 32-byte token; DB stores only `base64url(SHA256(session_secret ":" token))`; `HttpOnly`, `SameSite=Lax`, `Secure` iff `PUBLIC_BASE_URL` starts with `https://`; TTL from `AUTH_SESSION_TTL_HOURS`. Extractors: `CurrentUser` (`FromRequestParts`, 401) and `AdminUser(CurrentUser)` (403). Group gate via `normalize_group_name` (lowercase, strip non-alphanumerics) against `AUTH_ALLOWED_GROUPS`; `is_admin` is recomputed at each login from `AUTH_ADMIN_GROUPS` (default `admins`).
- **Bookings** (`src/bookings/mod.rs`): each booking targets exactly one Tofino or `servers.reservable = true` server. Validation (`ts % 3600 == 0`, max duration from settings, default 14 days), then `state.db.begin_with("BEGIN IMMEDIATE")` and resource-specific `ensure_no_overlap` (`start_ts < ?end AND end_ts > ?start`, excluding self on PATCH) → 409 Conflict. After commit: enqueue CalDAV upsert/delete per enabled calendar and `caldav_notify.notify_one()`. UID scheme `rsvp-{booking_id}@{CALDAV_UID_DOMAIN}`, immutable in `bookings.ics_uid`; `sequence` bumps on edit.
- **Inventory detail:** `servers` carry `cpu_model`/`cpu_sockets`/`cpu_cores`/`cpu_threads`/`cpu_mhz`/`memory_gb`, `nics` carry `ifname`/`mac`/`numa_node`/`kind` (`pf`|`vf`) plus the operator-facing `usage` label. Nullable numerics mean "not documented": PATCHing `0` (or a negative NUMA node) clears them, omitting keeps them (`merge_count`/`merge_measure`/`normalize_numa_node` in `devices/mod.rs`). Link state and negotiated speed remain deliberately unstored. The Servers NIC overview hides `usage = "Management"` by default and offers a checkbox to show it.
- **Physical links** (`src/ports/mod.rs`): `GET /tofino-ports?tofino_id=` for any user (inactive Tofinos hidden from non-admins, like `GET /tofinos`); admin `POST /admin/tofinos/{id}/ports`, `PATCH|DELETE /admin/tofino-ports/{id}`, `POST /admin/tofinos/{id}/ports/import`. A port is plugged into at most one other port, NIC, or free-text peer. Port↔port and NIC↔NIC links are mirrored, and editing either endpoint re-cables the same relation inside `BEGIN IMMEDIATE`. `cable_label` and `comment` describe the cable and are synchronized to both endpoints; `nics.usage` stays per-NIC. Both admin editors use the shared cascading peer picker (type → device → endpoint). `src/ports/markdown.rs` parses imported Markdown tables and resolves structured peers in a second pass.
- **CalDAV** (`src/caldav/mod.rs`): tokio worker loops `select! { caldav_notify.notified(), interval(300s) }`, drains `caldav_sync_queue` rows that are pending or errored with backoff `2^attempts * 30s` (attempts capped for shifting), abandoning after 10 attempts. Upsert = `PUT {caldav_url}/{ics_uid}.ics` with Basic auth; delete = `DELETE`, 404 counts as success. Queue snapshots the ICS payload at enqueue time so deletes survive booking-row removal. `POST /admin/caldav/calendars/{id}/test` = live PROPFIND. `src/caldav/ics.rs` is a hand-rolled RFC 5545 VEVENT builder (text escaping, CRLF, 75-octet folding, UTC `YYYYMMDDTHHMMSSZ`, SUMMARY from the settings template `{resource} — {user}`; legacy `{tofino}` still works) — unit-tested, deliberately no icalendar crate.
- **Tests:** inline `#[cfg(test)]` units (group normalization, ICS builder, config parsing, date math) plus integration tests with in-memory SQLite + `tower::oneshot` and wiremock for the CalDAV worker.

## Frontend (`frontend/`)

- **Stack:** React 19 + TypeScript (strict) + Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`, tokens in `src/index.css`, class-based dark mode), react-router-dom 7, @tanstack/react-query 5, date-fns 4, lucide-react, `cn()` = clsx + tailwind-merge (`src/lib/cn.ts`).
- **API layer (`src/api/`):** `types.ts` is the hand-written source of truth for API types and everything imports from it (via `client.ts` re-exports). `schema.ts` is generated from `fixtures/openapi.json` (`npm run generate:api`) — do not hand-edit. `client.ts` = typed `request<T>` fetch wrapper (401 dispatches a window event); `queries.ts` = react-query hooks + query keys.
- **Routing (`src/App.tsx`):** `/login` public; `ProtectedRoute` → `AppShell` wraps `/` (OverviewPage: my bookings, my NIC claims as a separate non-bookable list, and a filterable table containing only actual upcoming bookings via `lib/filters.ts`), `/servers` (one top-level overview lists every named server and uses `ServerNicMap` to group PCI functions by device, with NIC colors/highlighting shared across servers by claim Comment; complete responsive `NicTable` cards follow below, with one admin `NicModal` for usage/speed/owner/cabling and reserve links for reservable servers), `/tofinos` (cards link into the port map), `/tofinos/:tofinoId` (`TofinoPortsPage`: code-rendered 8×4 interactive faceplate in `components/TofinoFaceplate.tsx` above the filterable port table; hover/focus details, filter dimming, admin click-to-edit; read-only FP port/dev port/pipe, grouped peer picker — every other Tofino port, every server NIC, or free text — plus add-port and Markdown-import modals), `/topology` (all Tofinos and servers in a horizontally scrollable SVG diagram; `lib/topology.ts` deduplicates mirrored switch links and carries explicit endpoint IDs/labels plus a Comment-derived usage group—NIC claim Comment for server links, port Comment for switch links; `TopologyPage` renders one usage-colored line per physical link with labeled port/NIC rails, Usage/link-type filters, and an accessible connection list grouped by usage), `/calendar?resource=&view=&date=` (legacy `tofino`/`week` params still parse); `/admin/*` behind `AdminRoute` → `AdminLayout` → devices/tofinos/caldav/settings pages.
- **Calendar (`src/components/calendar/`):** custom-built week and month grids (react-big-calendar/FullCalendar deliberately avoided). `WeekCalendar` is a 7 × 24 hourly grid with `BookingBlock` row spans and clickable empty slots; `MonthCalendar` is a six-week overview whose day buttons open the detailed week. Own bookings open edit/delete, others show tooltips. All slot/period math is in tested `src/lib/date.ts` (Monday week start, local display, UTC storage; vitest pins `TZ=Europe/Berlin` for DST specs).
- **"All resources" combined view:** the calendar renders every active Tofino and reservable server together — per-resource colors, overlapping bookings laid out side by side within a week slot, legend chips identifying each resource. `reserveFreeLane={<bookable count>}` makes each overlap cluster lay out one lane more than it needs, so the strip beside a booking stays uncovered and the slot button underneath remains clickable for another resource.
- **Theme:** `src/lib/theme.tsx` ThemeProvider (`system|light|dark`, `.dark` class, localStorage); toasts in `src/lib/toast.tsx`.
- **Dev proxy:** `vite.config.ts` proxies `/api`, `/swagger-ui`, and `/branding` to `http://localhost:3125` (override with `VITE_API_PROXY_TARGET`); optional allowed hosts come from `VITE_ALLOWED_HOSTS`.
- **Scripts:** `npm run dev | build | lint | test | preview | generate:api`. Tests: Vitest + jsdom (`date.test.ts`, `filters.test.ts`, `format.test.ts`, `client.test.ts`, `WeekCalendar.test.tsx`).

## Inventory scripts (`scripts/`)

- `collect-nics.sh` — POSIX sh, runs on a host (`ssh <host> sh -s < collect-nics.sh`), prints two TSV sections: `=== host` (CPU model/sockets/cores/threads/max MHz, memory, arch) and `=== nics` (ifname, `bus.function` short name, PCI address, vendor/model, driver, speed + where the speed came from, link, MAC, NUMA, pf/vf, bridge, VM usage). Reads `/proc` and `/sys`; `lspci`/`ethtool`/`lscpu` are optional. `PCI_ROOT`/`PVE_ROOT` override the sysfs and Proxmox roots for fixture testing. Proxmox usage = VMs with the device passed through (`hostpciN`, incl. `mapping=` resource mappings); bridge membership is reported as a bare bridge name, never expanded into a VM list. Guest configs come from `${PVE_ROOT:-/etc/pve}` directly, else `sudo`, else `qm`/`pct` — all need root, and the host section's `pve` field says which route worked so an empty column is never silent. `[snapshot]`/`[PENDING]` sections are skipped; debug with `sh collect-nics.sh --pve-usage <pci>`.
- `nic_inventory.py collect|seed` — fans the collector out over SSH into `nics.json`, then seeds either a running instance (`--api` + `--cookie`) or a migration (`--sql`). Idempotent: servers matched by name, NICs by PCI address, missing CPU/memory facts and empty NIC usage labels filled in, nothing non-empty overwritten. `--name-style short|ifname` picks the NIC name (default `65.1`, matching the port map).
- `vlan_inventory.py collect|seed` — discovers a management switch's ports + VLAN config over SNMP v2c (needs the net-snmp `snmpwalk` CLI locally; no SSH). Walks the Q-BRIDGE dot1q static tables (`dot1qVlanStaticEgressPorts` − `dot1qVlanStaticUntaggedPorts` = tagged) plus `dot1dBasePortIfIndex`/`ifName` for port names, writes `vlans.json`, then seeds a running instance (`--api` + `--cookie`, creating the switch if missing) or a migration (`--sql`) via the same `POST /admin/management-switches/{id}/import` idempotent fill-gaps path. One switch = positional `host` + `--community` (or `$SNMP_COMMUNITY`); many at once = `--switches-file scripts/switches.txt` (comma-separated `<ip>, [name], [community]` per line, so names may contain spaces), which emits a `{"switches": [...]}` batch that `seed` fans out. Bitmap→port and hex-string decoding are unit-tested inline.

## Config / environment

Env is read from the process environment (`Config::from_env`, no dotenv loader); root `.env` + `docker-compose.yml` are the source of truth, `.env.example` documents every variable. Key vars: `PORT` (container, 3000) / `BIND_ADDR` (dev fallback `0.0.0.0:3125`), `HOST_PORT` (compose publish, 4343), `DATA_DIR` (host dir bind-mounted at `/app/data`, `./data`), `DATABASE_URL`, `FRONTEND_DIST`, `PUBLIC_BASE_URL`, `SESSION_SECRET`, `AUTH_SESSION_TTL_HOURS` (168), `AUTHENTIK_ISSUER_URL/CLIENT_ID/CLIENT_SECRET/REDIRECT_URI` (derived from `PUBLIC_BASE_URL` when unset) `/SCOPES/GROUPS_CLAIM`, `AUTH_ALLOWED_GROUPS`, `AUTH_ADMIN_GROUPS`, `AUTH_DEV_MODE`, `APP_NAME/SUBTITLE/TAGLINE/LOGO_URL/FAVICON_URL`, `BRANDING_DIR`, `CALDAV_PRODUCT_ID`, `CALDAV_UID_DOMAIN`, `RUST_LOG`, and `TIMEZONE`.

## Gotchas

> `GET /api/v1/auth/dev-login` returns **404 unless `AUTH_DEV_MODE=1`** — a "missing route" during dev usually just means the flag isn't set.

> Authentik providers need a **Signing Key** assigned (Advanced protocol settings). Without it the JWKS endpoint returns `{}` and login fails with "upstream service error".

> `PUBLIC_BASE_URL` must include the port when not on 80/443 (e.g. `http://localhost:4343`) — the redirect URI is derived from it and Authentik matches redirect URIs **exactly**; a missing `:4343` yields a redirect_uri mismatch.

> Nextcloud public **share links are read-only** and useless for sync. The admin form needs the calendar's internal CalDAV URL ("Copy internal link" → `.../remote.php/dav/calendars/<user>/<calendar>/`), the username, and an app password.

> Group names are **normalized** before comparison (lowercase, non-alphanumerics stripped): `kn-staff` == `knstaff` == `KN Staff`. Don't "fix" apparent mismatches in configs.

> In the All-Tofinos calendar a booking block must **not** span the full day column — it would swallow clicks on the slot button underneath and block parallel bookings on other Tofinos. That is what `reserveFreeLane` is for; don't "simplify" it away.

> Port maps are deployment data. Import them through **Import Markdown** in the port view rather than adding them to public schema migrations.

> `collect-nics.sh` walks **`/sys/bus/pci/devices` (class `0x02*`), not `/sys/class/net`**: a NIC passed through to a VM is bound to `vfio-pci` and has no kernel interface, so netdev enumeration silently misses exactly the interesting cards. Those rows carry an empty `ifname`, `link=passthrough`, and no MAC or speed.

> `collect-nics.sh` prepends `/usr/sbin` etc. to `PATH`: Debian's sshd gives non-root users a PATH without the sbin directories, so `ethtool` is invisible and every **down** link (the normal state of a spare testbed port) would silently report speed 0.

> A `nic_claims` row is **NIC documentation, not proof of ownership**: it may have no `user_id` and an empty `assignee_name` when it only carries the cable label/comment of a link. Test with `claimOwner(nic.claim)` (frontend) rather than `nic.claim !== null`, or free NICs render as claimed by nobody.

> Releasing a claim on a **cabled** NIC keeps the row (owner cleared) so the shared cable documentation survives; on an uncabled NIC the row is deleted as before. **Free NIC** (`POST /admin/nics/{id}/free`, the UI's only one-click action) removes everything instead: the claim row, the NIC's own "Used by" label, the link (Tofino port, NIC, or management port), and the cable label and comment on both ends — a peer NIC keeps its owner and its own "Used by".

> Adjacent bookings are **legal**: overlap is `start < other.end AND end > other.start`, so `end == start` back-to-back bookings must succeed (there's a test for it).

> tower-http needs the **`fs` feature** for `ServeDir`/`ServeFile` — dropping it breaks SPA serving with a confusing compile error.

> Session cookies are `Secure` **only when `PUBLIC_BASE_URL` is https** — behind plain-http setups the cookie intentionally isn't `Secure`, or login would silently fail.

> Nextcloud **app passwords are stored in plaintext** in SQLite (`caldav_calendars.app_password`) — the API never returns them (`has_password` only), but treat the DB file (`./data/rsvp.db` on the host) as secret.
