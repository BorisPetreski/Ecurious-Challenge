# BayReady setup and operations

BayReady runs as an Expo mobile app with direct GoingElectric discovery, Supabase software holds, a separate laptop simulator, read-only Ecurious diagnostics and a guarded designated-bay worker. Hosted schema/Auth are configured. The current test deployment enables only `lock-0002`, enrolled as a **barrier-only interface at 0 kW**, with no charger or GoingElectric mapping. Direct raise/lower movements and a worker idle cleanup have been confirmed through newer provider observations. The booking → matching plate → occupied arrival → departure cycle remains unverified; electrical charging telemetry is unavailable.

This guide describes the code and evidence recorded on 24 October 2026. Use [the integration guide](INTEGRATION.md), [Supabase contract](SUPABASE.md), [Ecurious observations](ECURIOUS-API.md) and [build log](BUILD-LOG.md) for their respective boundaries.

## Current hardware checkpoint

The active development processes use API port **3001** and Metro **8081**. Code defaults remain disabled for a new deployment; the current operator-configured backend has commands enabled and an allowlist containing only `lock-0002`, with both database control/interlock gates enabled.

| Evidence on 24 October 2026, UTC | Observed result |
| --- | --- |
| Direct bench raise, `13:54:55.309Z` | Acknowledgement followed by a strictly newer raised/vacant observation. |
| Direct bench lower, `13:54:59.709Z` | Acknowledgement followed by a strictly newer lowered/vacant observation. These bench calls were outside the application operation ledger. |
| Camera policy, `13:55:56.915Z` | Acknowledged clear request followed by reported disabled policy/count zero. This is not independent EEPROM verification. |
| Worker idle cleanup, `14:01:45Z` | Lowering/idle cleanup confirmed; no plate-bound booking or occupied arrival was established. |
| Fresh sample, `14:22:21.966Z` | The operator re-enabled the database control in phase `idle`; interlocks remained confirmed. Later sample ageing returned `blocked` / `TELEMETRY_UNKNOWN` while the enable flag stayed true. |

Provider samples at `14:19:21.962Z` and `14:22:21.966Z` were about three minutes apart. Polling every five seconds does not make retained sensor data new. The movement preflight still requires a sample within **five seconds**; an enabled control can therefore spend most of this observed interval waiting on telemetry. An old vacant report is never current vacancy.

The next additive telemetry-waiting update is in progress at this checkpoint. Its intended behavior is to store eligible Now/Scheduled intent while physical state is unknown, show protection pending, and wait for a fresh safe sample within the original deadline. Unknown telemetry must not become a `LOCATION_FULL` claim. Occupied, faulty, uncertain or already-owned resources remain blocked, and the five-second movement guard is unchanged. Check [the build log](BUILD-LOG.md) for deployment confirmation before relying on that update.

## Requirements and first checkout

- Node 24 or newer and npm.
- Android with an Expo Go release compatible with this project's Expo SDK 58.
- Internet for GoingElectric and Supabase; a shared laptop/phone network for the local simulator and Ecurious panel.
- Docker only when running the isolated database tests.

The root backend uses Node built-ins. Install the mobile dependencies from the lockfile:

```sh
npm --prefix mobile ci
```

On a fresh checkout, create a root `.env` from [the example](../.env.example) if needed. Add only the configuration for the services you intend to use. An existing `.env` must be preserved when updating the project. [mobile/.env.example](../mobile/.env.example) documents optional phone-specific overrides; a separate `mobile/.env` is usually unnecessary when using the root launchers.

Real environment files, `node_modules`, `.expo`, `.local`, captures and private runtime files are Git-ignored. The launchers do not commit, push, publish an app or create cloud resources. Keep actual keys and exported bundles out of source handoffs; the registered directory credential is present in the mobile runtime even though it is absent from tracked source.

## Configuration matrix

Only variable names are listed here; no credentials are reproduced.

| Variable | Read by / usual location | Visibility and purpose |
| --- | --- | --- |
| `ECURIOUS_MODE` | Node backend / root `.env` | Simulator mode. Only mock mode is accepted; choosing live mode refuses startup. |
| `PORT` | Node backend and combined launcher / root `.env` or shell | Local API port. The combined launcher passes it to the phone client. |
| `HOST` | Standalone backend / root `.env` or shell | Network bind address. Combined mobile startup and `server:lan` explicitly select the LAN bind address. |
| `ECURIOUS_API_KEY` | Backend adapter / root `.env` | Private hardware credential for projected reads and explicitly gated commands. Removed from the Expo child environment. |
| `ECURIOUS_BASE_URL` | Backend adapter / root `.env` | Optional HTTPS origin for the challenge service. Paths, URL credentials and query parameters are not accepted. |
| `ECURIOUS_COMMANDS_ENABLED` | Backend only / root `.env` | Exact `true` or `false`; defaults false. Explicit activation does not replace enrolled interlock/mapping checks. |
| `ECURIOUS_LOCK_IDS` | Backend only / root `.env` | Comma-separated confirmed assigned lock IDs; at most 20. Never inferred from directory locations. |
| `SUPABASE_SECRET_KEY` | Backend worker only / root `.env` | Secret database key for private workflow RPCs; never Expo/public configuration. |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend worker only / root `.env` | Legacy privileged alternative to the secret key. |
| `ELECTRIC_API_KEY` | Root mobile launchers / root `.env` | Registered GoingElectric app credential. Forwarded to the phone for direct directory requests. |
| `GOINGELECTRIC_API_KEY` | Root mobile launchers / root `.env` | Alternate name for the same directory credential. |
| `SUPABASE_URL` | Root mobile launchers / root `.env` | Public project origin, forwarded to the mobile client. |
| `SUPABASE_PUBLISHABLE_KEY` | Root mobile launchers / root `.env` | Public Supabase client key. Does not grant schema-management access. |
| `SUPABASE_ANON_KEY` | Root mobile launchers / root `.env` | Alternate legacy anon-key name. |
| `SUPABASE_API_KEY` | Root mobile launchers / root `.env` | Existing legacy alias; accepted only when its role is anon or it is a publishable key. |
| `EXPO_PUBLIC_API_URL` | Mobile client / shell or `mobile/.env` | Explicit laptop API URL reachable from the phone. Contains no credentials. |
| `EXPO_PUBLIC_API_PORT` | Mobile client / launcher, shell or `mobile/.env` | Simulator port used with an automatically detected laptop address. |
| `EXPO_PUBLIC_GOINGELECTRIC_API_KEY` | Mobile client / launcher or `mobile/.env` | Directory key available in the app bundle and on the device. |
| `EXPO_PUBLIC_SUPABASE_URL` | Mobile client / launcher or `mobile/.env` | Public Supabase project origin. |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Mobile client / launcher or `mobile/.env` | Public publishable or validated legacy anon client key. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Mobile client / shell or `mobile/.env` | Legacy public-key fallback when no publishable-key setting is provided. |

The default API port is 3000; the current development session uses 3001. The standalone backend defaults to loopback; mobile startup binds it to all local interfaces. The default Ecurious origin is the supplied [challenge service](https://parking-lock-service-production.up.railway.app/). These defaults do not configure a production deployment.

Root launchers load the optional root `.env`, then construct the Expo child environment in [mobile-environment.mjs](../scripts/mobile-environment.mjs). Directory-key precedence is the public Expo name, then `GOINGELECTRIC_API_KEY`, then `ELECTRIC_API_KEY`. Supabase-key precedence is the public publishable name, public anon name, root publishable name, root anon name, then `SUPABASE_API_KEY`. The selected key is forwarded under the public publishable name, including when it is a legacy anon JWT. The public Supabase URL takes precedence over the root URL.

The launcher rejects a secret/service-role value in an accepted Supabase client-key setting and removes root `SUPABASE_*` variables from the Expo child environment. It is not a general secret scanner: never place hardware, administrator or other private credentials in any `EXPO_PUBLIC_` variable. Those settings are intended for values available to app users. The mobile client independently checks the accepted Supabase key type.

Restart Expo after changing mobile configuration. Restart the backend after changing the Ecurious key or origin. Restarting `npm start` does both and clears the in-memory simulator's state; it does not clear persistent Supabase holds or device profile/session storage.

## Run on Android with Expo Go

From the repository root:

```sh
npm start
```

[start-mobile.mjs](../scripts/start-mobile.mjs) checks the API port, starts its own backend on the LAN, waits for mock API health, prints candidate phone API addresses, then starts Expo with LAN access on Metro port 8081. Connect the laptop and phone to the same Wi-Fi and open the terminal QR code in Expo Go. Keep the terminal open; Ctrl+C stops both owned processes. If either child exits unexpectedly, the launcher stops the other.

If the API port is occupied by another process you are using, select a different port:

```sh
PORT=3001 npm start
```

The combined launcher forwards that port to the mobile client. A separately launched Expo process does not infer its API port from the backend's `PORT`; provide the public port or full public API URL when separating the processes.

| Command | Starts / checks |
| --- | --- |
| `npm start` | LAN simulator API and Expo together; Metro defaults to 8081. |
| `npm run mobile` | Expo only through the root environment-filtering launcher. |
| `npm run android` | Expo only and requests Android opening; the phone still needs a reachable backend for simulator features. |
| `npm run ios` | Expo only with the iOS opening option; Android remains the primary target. |
| `npm run server:lan` | Local API/browser demo exposed to the phone's LAN. |
| `npm run server` | Local API/browser demo, loopback by default unless `HOST` is overridden. |
| `npm run dev` | Watches and restarts the standalone backend on source changes. |
| `npm run doctor` | Backend files, Node version, mock mode and loopback port availability. It does not check mobile/cloud/hardware readiness. |
| `npm run hardware:inspect` | Redacted assigned-lock report through read-only Ecurious GET requests; no server or Expo startup. |

For two terminals, run `npm run server:lan` and `npm run mobile` from the root. Starting Expo directly inside `mobile/` bypasses the root key mapping and filtering; configure only the intended public variables there. Prefer the root commands for the documented setup.

The client normally derives the laptop address from Expo's development URL. A physical phone's `localhost` is the phone, not the laptop. Use `EXPO_PUBLIC_API_URL` when automatic detection is unsuitable. Activity's developer section displays the selected local API address; the browser demo is available on the laptop at the same API port.

## First-use and demonstration sequence

1. Complete the local driver profile or choose **Explore map first**. Editing it later returns to the retained map. Contact fields and the raw plate remain in native SecureStore; browser previews use memory only. These details do not authenticate a Supabase user.
2. Search the initial Berlin viewport or pan and choose **Search this area**. **My location** requests foreground permission only when tapped; denying it still permits manual browsing. The initial location is a fixed view, not a detected position.
3. Use Filters for minimum power, the saved connector, reported faults, reserved inventory and test locations. Public GoingElectric entries are visible by default. Their physical availability is unknown, and listed plug counts are not registered bay identities.
4. Choose a listed app plug at a public directory location. Hosted Supabase is configured. A fresh complete read marks an absent current hold **unreserved in BayReady**. Now/free ten minutes or a calendar booking allocates its software window; other listed choices remain independent. Profile contacts are not sent to this booking service. Reported-fault locations disable new app holds in the UI.
5. Separately, enable **Show test location** for the explicitly fictional registered Berlin inventory. Choose a bay and an individual compatible plug. This registered-inventory hold covers every plug on that physical-bay model, unlike an independent directory app slot.
6. Inspect the server-derived deadline and cancellation from the booking card or reserved list. A countdown reaching zero does not free a slot or bay until a new database read confirms it. Your directory holds stay cancellable even after moving outside the original viewport or after the listed catalog changes.
7. Use `/reserve` for the independent simulator and Activity for its timeline/diagnostics. Activity links to `/hardware`, currently configured for the separate `lock-0002` barrier test. Inspect current telemetry and operation status there; a pending intent or an enabled gate does not establish protection. Simulator controls never modify database holds or real hardware.

GoingElectric, Supabase and local API failures are independent. The map/profile can still be used without a running laptop simulator; cloud discovery and shared holds require their respective services and internet. No offline fake hold replaces an unavailable database.

## Activate the hosted reservation database

Follow [SUPABASE.md](SUPABASE.md) for the complete schema, ownership and migration contract. The configured public key does not authorize DDL or project configuration. A connected administrator must inspect the target project and its applied-migration history first.

The hosted project already has the reviewed schema and Auth configuration. Inspect its pinned version/checksum history through `node --env-file-if-exists=.env scripts/setup-supabase.mjs --inspect`. Apply only reviewed additive changes through the guarded path in [SUPABASE.md](SUPABASE.md); never rerun an applied migration or reset project data. Directory software allocation, fictional whole-bay holds and guarded physical inventory remain separate.

Anonymous sign-ins and manual identity linking are enabled in the current project. Anonymous authentication creates a guest with a persistent owner UUID; an anon API key alone does not provide that identity. Native sessions use serialized SecureStore chunks. Browser previews keep them in memory, so refreshing can lose a guest identity.

Use two devices/sessions to confirm exclusivity of the same listed app slot, independence of different slots, deadline visibility, owner-only cancellation and expiry. Separately confirm whole-bay allocation across different plugs on one registered bay. Record these as hosted evidence only after observing them. The prepared registered seed has no real GoingElectric or Ecurious mapping, and its reserve RPC refuses Ecurious-mode bays. Inventory administration is not exposed to the phone.

Directory holds store a station reference, opaque 64-character slot key, owner and booking timestamps/state. The phone derives keys from versioned station/type/power groups and an ordinal; it sends no location names, coordinates, connector catalog or profile values. A fresh read covers at most 500 requested stations and also includes all caller-owned active holds elsewhere. Slot metadata changes may leave an old virtual key unmatched; its owned hold remains available for cancellation. SQL validates reference format and allocation conflicts, not whether a supplied slot exists in GoingElectric or represents a distinct physical vehicle space. These software holds neither reserve an external operator's charger nor protect a bay with hardware.

Official references: [Supabase anonymous authentication](https://supabase.com/docs/guides/auth/auth-anonymous), [client/server key types](https://supabase.com/docs/guides/getting-started/api-keys), [database migrations](https://supabase.com/docs/guides/deployment/database-migrations) and [API access controls](https://supabase.com/docs/guides/api/securing-your-api).

## Failure handling and troubleshooting

| Symptom | Interpretation and next action |
| --- | --- |
| Startup asks to install dependencies | Run `npm --prefix mobile ci` from the root. Root backend dependencies do not need a separate install. |
| API port unavailable | Stop the specific server you own or choose another `PORT`. `doctor` also reports an occupied port when the app is already running. |
| Expo loads, simulator stays unreachable | Confirm the backend is running on the LAN, review Activity's API address, and check laptop firewall and Wi-Fi device isolation. A shared hotspot can replace an isolated venue network. |
| Expo tunnel works but API does not | A Metro tunnel does not forward the separate Node API. Provide an independently reachable API address or use the same local network. |
| Expo Go SDK mismatch | Install the matching SDK 58 release using [Expo Go downloads](https://expo.dev/go). This starter does not require Android Studio or a native build. |
| No directory key or authentication failure | Check the registered app-key setting and restart Expo. Inspect only whether a key is present; do not print it or share a credential-bearing request URL. |
| Empty directory results | Review the preferred connector and manual power filter, move to a smaller/relevant viewport and search again. A station without a current displayed result is not proof of removal or unavailability. |
| Previous map results disappear | Directory results deliberately expire from memory after roughly one hour, including a check when returning to the foreground. Search again for a fresh snapshot. |
| Location permission denied | Continue with pan/zoom, or enable the app's foreground permission in device settings and retry the location control. Background tracking is not implemented. |
| Supabase setup/auth error | Inspect the applied migration/checksum history and Auth flags with npm run supabase:setup -- --inspect. A public client key cannot perform administrator changes. Do not switch to a service-role key in the app. |
| Reservation response is uncertain | Do not blindly repeat the write. The provider reads availability afterward; refresh and inspect your restored hold before trying another action. SDK retries are disabled for booking RPCs. |
| Another driver reserved the bay | `BAY_RESERVED` is an expected allocation conflict. Refresh and choose another registered bay. Choosing another plug on the same bay cannot bypass its hold. |
| Another driver reserved the listed app plug | `PLUG_RESERVED` is an expected software-slot conflict. Refresh and choose another unreserved app slot. This does not establish the actual charger or bay's occupancy. |
| Directory hold has only a station reference or unmatched plug label | A viewport/catalog change can remove its display metadata. Your own active hold remains in the reserved list and can still be cancelled without restoring the directory catalog. |
| Reserved countdown reaches zero but marker stays reserved/stale | Expiry is governed by database time and a new server read, not the phone clock. Refresh when connected. |
| Profile or guest session cannot be restored | Retry device storage without overwriting unreadable data. Profile save failures retain the form draft. Do not clear app storage as routine troubleshooting while depending on an active guest-owned hold; a lost guest identity cannot be recovered; optionally upgrade it to verified email/password first through Profile → Sign in & account. |
| Hardware key rejected after rotation | Update the backend setting and restart it. Phone configuration does not contain or update that credential. |
| Hardware is enabled but shows `TELEMETRY_UNKNOWN` | Configuration and sample freshness are separate. The observed device cadence was about three minutes; wait for a new provider sample. Keep protection pending and preserve the five-second movement rule. Do not reset ownership or claim physical vacancy from the earlier sample. |
| Hardware appears offline, old or unknown | Inspect provider time/connectivity. HTTP health and a successful poll do not refresh a stored sensor sample. Confirm device behavior with the operator if fresh data stops arriving. |
| Hardware shows wildcard camera access | Protection preflight must fail because another recognized plate could lower the arm. The test's reported policy was cleared at `13:55:56.915Z`; every later preflight must still check it. |

The Ecurious adapter uses a six-second request timeout, a 1 MiB body limit and no redirects. Its 60-second telemetry display limit is an app policy, not a certified safety threshold. The phone's hardware request has its own 12-second outer limit. The hardware panel ages retained snapshots; a failed refresh leaves physical state unknown.

The simulator polls every two seconds while active and uses seven-second client requests. Both Supabase booking domains poll every ten seconds in the foreground, with a 25-second read-age guard for actions and eight-second fetch limits. Moving to a different directory query scope immediately invalidates its old availability observation before effects or new requests run. Missing holds imply app-unreserved only inside a fresh complete read of the requested stations; failed or stale reads remain unknown. Reserve/cancel writes are serialized within each provider/hook and followed by a read even after an uncertain result. These connection policies do not assert physical vacancy. GoingElectric queries have ten-second limits, a 500-station normalization cap and bounded in-memory retention; zoom and repeat the search if results are truncated.

## Verification commands and recorded limits

```sh
npm test
npm run check
npm run mobile:doctor
```

For database rules, Docker must be running and the public `postgres:17-alpine` image must already be available locally. Pull it explicitly if needed, then run:

```sh
docker pull postgres:17-alpine
npm run test:database
```

[test-database.mjs](../scripts/test-database.mjs) starts only its own labelled, temporary PostgreSQL container with no network, published port or persistent database volume. It reads no `.env`, creates local test-only auth shims, applies the migrations, runs contract/upgrade tests and competes through independent SQL sessions. Cleanup checks the ownership label before removing its container. A passing run does not deploy anything to Supabase or validate hosted Auth/PostgREST.

The driver-profile [build-log checkpoint](BUILD-LOG.md) records 63 passing Node tests, syntax/mobile TypeScript checks, an Android bundle export, and isolated PostgreSQL validation of the first two schema versions, upgrade preservation, permissions, ownership, expiry and concurrency. Earlier native-map/shared-booking checkpoints recorded all 20 Expo Doctor checks passing. Mocked mobile/provider checks covered validated responses, retry suppression, session storage and corrupt-profile protection. Bundle scans at those checkpoints excluded server credentials.

The directory-hold checkpoint passed **81 combined Node tests**, syntax/mobile TypeScript, all three migrations and independent-session database races, and a fresh Android bundle export with server credentials absent. It includes seven [pure contract tests](../test/directory-booking-contract.test.mjs), six [mocked hook tests](../test/directory-bookings-hook.test.mjs) and five [slot identity/pagination tests](../test/directory-slots.test.mjs). The hook tests execute the real hook through controlled state/effect timing and stubbed network calls, covering immediate viewport invalidation, failed-read behavior, duplicate-write suppression, uncertain-result reconciliation, outside-viewport cancellation and scope changes during a write. They use the already-installed mobile TypeScript package; install mobile dependencies before running them. They do not render native components or contact the hosted project. See the latest [build-log entry](BUILD-LOG.md) for exact evidence and exclusions.

Historical software checks are not a fresh health check or proof of Android touch behavior. Hosted setup and the barrier movements/cleanup have separate dated evidence above. Two-phone synchronization, live plate-bound entry with occupied/departure sensor observations, and the complete challenge cycle remain unverified. Existing hardware observations must not be presented as current after they age out.

## Deployment boundary

Expo Go is the current development target. An independent Android binary needs its own Google Maps SDK configuration; the directory API key does not configure map tiles. Required basemap branding remains visible. See [Expo native-map setup](https://docs.expo.dev/versions/latest/sdk/map-view/).

No production backend, release build, hosted Node deployment, payment processor or administrator console is configured. The LAN simulator has no user authentication and exposes rehearsal controls; it is not the production reservation service. A production design still needs authenticated operations, deployment/secrets management, retention and account recovery, inventory administration, monitoring, and confirmed physical control/event contracts. Implementing those is separate from activating the prepared software-hold schema.

Use the enrolled barrier-test mapping and the recorded operator confirmations for the scoped hardware demonstration. Keep its no-charger boundary visible. Record commands, acknowledgement versus newer observations, failures and the still-missing plate/occupancy sequence in [BUILD-LOG.md](BUILD-LOG.md); a read-only panel or a partial bench cycle does not complete the challenge cycle.

## Activate or recover the designated hardware worker

Follow [HARDWARE-SETUP.md](HARDWARE-SETUP.md) for enrollment and recovery. New controls default disabled and migrations seed no real lock. The current `lock-0002` barrier-only row has the operator-confirmed mapping/interlocks and explicit backend activation described above. A new deployment still requires those independent gates. Keep `ECURIOUS_MODE=mock`: it describes the separate simulator and does not select physical workflow mode.

Protection, entry and release are authenticated application intents. The private worker takes a durable claim, validates current observations, commits one dispatch permit, sends at most one command and waits for confirmation. It polls every five seconds. The control observation policy defaults to five seconds; the phone polls every five foreground seconds and pauses actions after fifteen seconds without a workflow response. Missing or malformed fault telemetry, water-ingress uncertainty, stale occupancy, wildcard auto-access for protection, conflicting timestamps or an unassigned lock prevent movement.

No-ACK delivery uncertainty cannot be resolved automatically by a matching GET, expiry or lease timeout. Stop every dispatcher and its in-flight requests, inspect the designated hardware with the operator, then follow the documented privileged recovery process. Restarting a worker does not release the database guard or repeat its command. A pending owner cancellation/no-show cleanup also keeps the hold until fresh vacant/lowered cleanup is confirmed. There is no app force-clear control.

The mobile connection uses LAN HTTP during development; its guest JWT therefore travels over that local connection. A hosted backend needs HTTPS, authenticated deployment and operational controls before use outside this rehearsal network. Private credentials remain backend-only in either setup.

An earlier hardware checkpoint passed **144 combined Node tests**, syntax/mobile TypeScript, isolated PostgreSQL contract/concurrency tests and Android export checks. Mocked tests cover uncertain delivery, delayed permits, shutdown, simultaneous workers, stale/conflicting observations, ownership and mobile no-retry behavior. Later actual barrier movements and cleanup are recorded separately above and in [BUILD-LOG.md](BUILD-LOG.md); they do not prove plate check-in, sensor-confirmed arrival/departure or charging.
