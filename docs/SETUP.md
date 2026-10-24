# BayReady setup and technology stack

This guide describes the pulled mobile implementation at `05b7986` for the 24 October 2026 demo. The quickest path is **Android + Expo Go + the direct Audimax hardware marker**. Shared map bookings and the older Node hardware workflow are separate paths.

## Run the demo

Requirements: Node.js **24 or later**, npm, an Android phone with an Expo Go version compatible with SDK 58, and internet access. No Android Studio, native build or root dependency installation is needed for this Expo Go demo.

```sh
git clone https://github.com/BorisPetreski/Ecurious-Challenge.git
cd Ecurious-Challenge
npm --prefix mobile ci
cp .env.example .env
```

If `.env` already exists, retain it. Enter the assigned credentials locally, then start from the repository root:

```sh
npm start
```

This starts Expo Metro on **8081** and the Node API on **3000**, binding the API to the LAN. Put the laptop and phone on the same Wi-Fi, scan the terminal QR code in Expo Go, and keep the terminal open. Ctrl+C stops both processes.

For the current direct hardware demo and directory map, Expo can run by itself:

```sh
npm run mobile
```

This does not start Node. The direct Audimax client and GoingElectric client call their providers from the phone; their requests do not depend on the local API. **Live Eventbrite events, the simulator and guarded backend screens need Node**, so use `npm start` for the complete demo. For the presentation flow, use the Audimax marker described in the [demo guide](DEMO.md), rather than the older dedicated hardware screen.

## Environment settings

Root launchers load `.env` and translate supported settings into public Expo variables. Restart Expo after changing keys or URLs. Keep actual `.env` files out of Git.

| Feature | Root `.env` setting | What it enables |
| --- | --- | --- |
| Direct Audimax test | `EXPO_PUBLIC_AUDIMAX_API_KEY` | Assigned lock reads, raise/lower commands and plate whitelist requests directly from the phone |
| Direct key alternatives | `AUDIMAX_API_KEY`, then `ECURIOUS_API_KEY` | Launcher fallbacks when the public Audimax variable is unset |
| Direct service origin | `EXPO_PUBLIC_AUDIMAX_BASE_URL` | Defaults to `https://parking-lock-service-production.up.railway.app`; launcher also accepts `AUDIMAX_BASE_URL` or `ECURIOUS_BASE_URL` |
| GoingElectric directory | `ELECTRIC_API_KEY` or `GOINGELECTRIC_API_KEY` | Passed to `EXPO_PUBLIC_GOINGELECTRIC_API_KEY` for direct map discovery |
| Shared bookings/Auth | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Passed to the phone as the corresponding `EXPO_PUBLIC_SUPABASE_*` settings |
| Legacy public Supabase key | `SUPABASE_API_KEY` or `SUPABASE_ANON_KEY` | Accepted alternative only when it is a public anon key |
| Local API port | `PORT=3001` | Changes the backend port when using `npm start`; default is 3000 |
| Eventbrite private token | `EVENTBRITE_PRIVATE_TOKEN` (alias `EVENTBRITE_TOKEN`) | Backend-only read access to the organization's or curated public events |
| Eventbrite organization | `EVENTBRITE_ORGANIZATION_ID` | Optional explicit organization ID; without it a single accessible organization is discovered |
| Curated Eventbrite events | `EVENTBRITE_EVENT_IDS=123,456` | Optional numeric event IDs; use actual selected events, not these example IDs |
| Explicit phone API address | `EXPO_PUBLIC_API_URL=http://<laptop-LAN-IP>:3000` | Overrides automatic laptop address detection |

The current direct demo intentionally exposes its Audimax credential to the phone through `EXPO_PUBLIC_AUDIMAX_API_KEY`; the launcher can derive it from `ECURIOUS_API_KEY`. This differs from the older backend-only hardware workflow. Treat it as assigned hackathon test access, and do not publish a bundle containing that credential. Supabase management, secret/service-role and plate-hash keys belong only on the backend.

The supplied hosted Supabase project already has its schema/Auth setup. **No migration or database setup command is needed to demonstrate the current direct Audimax flow.** A new Supabase deployment for shared bookings requires the separate [Supabase setup](SUPABASE.md).

Eventbrite's token stays on Node and all `EVENTBRITE_*` variables are stripped from the Expo child environment. Restart Node after changing these settings. Open **Events & Nearby Charging**, refresh, and choose the Eventbrite feed. If the connected organization has no eligible events near Munich, an empty live feed is correct; add actual event IDs to curate a selection or explicitly choose **Use demo events**. The API has no unrestricted public city-event search. See [the contract](API.md#eventbrite-event-feed).

If starting Expo directly inside `mobile/`, use `mobile/.env` with `EXPO_PUBLIC_AUDIMAX_API_KEY`, optional `EXPO_PUBLIC_AUDIMAX_BASE_URL`, `EXPO_PUBLIC_GOINGELECTRIC_API_KEY`, and public Supabase settings as needed. The root launchers perform the translations above; plain Expo does not.

## Frameworks and libraries

Versions below are the declarations in `mobile/package.json`; `mobile/package-lock.json` pins the installed dependency tree.

| Technology | Version | Role in BayReady |
| --- | --- | --- |
| Expo | SDK 58 (`~58.0.19`) | Development server, Expo Go runtime and native module integration |
| React Native | `0.88.0` | Android/iOS native UI |
| React / React DOM | `19.3.0` | Component/state model; DOM supports the optional web target |
| TypeScript | `~6.0.3` | Mobile types and compile-time checks |
| Expo Router | `~58.0.26` | File-based screens and navigation |
| react-native-maps | `1.29.11` | Full-screen map, location pins and native map interactions |
| expo-location | `~58.0.19` | User-triggered foreground location for map centering |
| expo-secure-store | `~58.0.2` | Local profile, Auth session and active demo hold storage |
| @expo/ui | `~58.0.23` | Native calendar/time picker via `@expo/ui/community/datetime-picker` |
| @supabase/supabase-js | `^2.118.0` | Supabase Auth and database RPC access for shared bookings |
| Node.js | `>=24` | Local HTTP API, simulator, launcher scripts and optional durable hardware worker |
| Supabase / PostgreSQL | Hosted service | Shared slot/bay reservations, access rules and transactional booking functions |

The Node backend uses built-in Node modules and has no root runtime dependencies to install. Payments are mock; there is no payment processor SDK. The barrier-only test rig supplies no real charger power or energy measurements.

## Files to show a teammate

| Path | Responsibility |
| --- | --- |
| `mobile/src/app/map.tsx` | Map, directory results and Audimax marker/booking orchestration |
| `mobile/src/components/audimax-booking-modal.tsx` | Direct live demo reservation and calendar UI |
| `mobile/src/lib/audimax-lock-api.ts` | Direct lock GET, lock/unlock POST, whitelist and local hold storage |
| `mobile/src/lib/goingelectric-api.ts` | Direct public charging-directory client |
| `mobile/src/lib/bookings-api.ts` | Supabase authentication and shared booking RPC client |
| `mobile/src/app/profile.tsx` | Local driver details and preferred connector |
| `server.mjs`, `lib/` | Independent simulator and older durable hardware workflow |
| `supabase/migrations/` | Versioned database schema/functions for shared/backend workflows |
| `scripts/mobile-environment.mjs` | Root-to-Expo environment translation |
| `mobile/app.json` | App identity, plugins and platform configuration |

## Commands and troubleshooting

| Command | Purpose |
| --- | --- |
| `npm start` | Start Expo and LAN API together |
| `PORT=3001 npm start` | Use API port 3001 when 3000 is busy |
| `npm run mobile` | Expo only; sufficient for direct Audimax requests |
| `npm run server:lan` | Node API only, accessible to the phone |
| `npm run server` | Node/browser demo on loopback |
| `npm run mobile:check` | Mobile TypeScript check |
| `npm run check` | Backend syntax and mobile TypeScript checks |
| `npm test` | Backend and contract tests |
| `npm run mobile:doctor` | Expo dependency/configuration diagnostics |

If the phone shows an old screen, reopen the project in Expo Go; restart Expo after environment changes. If Metro is busy, use the already-running project or stop your previous launcher before starting another. If a direct hardware request fails, check internet access, the assigned key and service URL; starting Node does not fix a provider authentication error.

For local API screens, `localhost` on the phone means the phone itself. The app normally derives the laptop address from Expo's LAN URL. With separate terminals and a custom API port, use `EXPO_PUBLIC_API_PORT=3001 npm run mobile`, or set `EXPO_PUBLIC_API_URL` explicitly. Venue Wi-Fi may isolate devices; a shared hotspot can resolve LAN reachability. An Expo tunnel forwards Metro, not the separate Node API.

Expo Go supplies its native map configuration for this demo. A separately built Android binary needs its own Google Maps SDK configuration/key; the GoingElectric key supplies directory data, not map tiles. Follow the [mobile guide](../mobile/README.md) for additional platform notes and the [system documentation](SYSTEM-DESIGN.md) for the other reservation paths.
