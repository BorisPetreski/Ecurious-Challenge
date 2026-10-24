# BayReady mobile

Expo SDK 58, React Native, Expo Router, and TypeScript. Android with Expo Go is the primary target. The map uses shared Supabase software holds; the separate lifecycle rehearsal uses the Node simulator. See the [system design](../docs/SYSTEM-DESIGN.md), [API contracts](../docs/API.md) and [operations](../docs/OPERATIONS.md). Activity also offers separate real, read-only Ecurious diagnostics; hardware commands remain unavailable.

## Run on your Android phone

From the repository root:

```sh
npm --prefix mobile ci
npm start
```

Dependencies are already installed in the current workspace. `npm start` starts the simulator API on the local network and Expo Metro on port 8081. Keep the terminal open. Update Expo Go on your phone, put the phone and Mac on the same Wi-Fi, then scan the terminal QR code using Expo Go. Ctrl+C stops both processes.

For separate terminals, run `npm run server:lan` in the root and `npm run mobile` in another root terminal. Running Expo by itself does not start the API.

## Edit the app

- `src/app/`: native screens and routing.
- `src/components/`: shared native UI and reservation context.
- `src/hooks/use-reservation.ts`: reservation state, foreground polling, and mutations.
- `src/lib/reservation-api.ts`: typed HTTP client, response validation, and API address selection.
- `app.json`: app name, scheme, platform configuration, and splash settings.
- `package-lock.json`: the installed dependency versions; commit it with package changes.

Use `npm run mobile:check` from the root for TypeScript, `npm run check` for all syntax/type checks, and `npm test` for the backend's lifecycle and HTTP tests. `npm run mobile:doctor` runs Expo's environment checks.

## API connection

The client normally derives the laptop's address from the Expo development URL and uses API port 3000. The root launcher passes a custom API port when you start with `PORT=3001 npm start`. Android emulator fallback uses `10.0.2.2`.

If automatic detection is unsuitable, copy `mobile/.env.example` to `mobile/.env` and set `EXPO_PUBLIC_API_URL` to the laptop's reachable API URL. Restart Expo after changing environment variables. The Activity screen's developer details show the selected address. A phone's `localhost` is the phone itself, so a physical Android device needs the laptop's network address.

Variables beginning with `EXPO_PUBLIC_` are included in the app. Use them for public settings and the registered GoingElectric app key required for direct device requests. Keep Ecurious hardware authentication on the backend. Reservation screen station examples remain synthetic and clearly labelled.

## GoingElectric map

First launch offers driver profile setup, with **Explore map first** for browsing. Returning drivers open the full-screen native map. Root `npm start`, `npm run mobile`, `npm run android`, and `npm run ios` accept `ELECTRIC_API_KEY` or `GOINGELECTRIC_API_KEY` from the root `.env`. Starting Expo directly inside `mobile/` instead requires `EXPO_PUBLIC_GOINGELECTRIC_API_KEY` in `mobile/.env`. Never commit keys; restart Expo after changing them.

The initial view is Berlin. Pan and zoom, then select **Search this area**. **Filters** contains power/connector controls, reported faults, reserved bays with expiry times, and directory-only chargers. The location button is at the lower right. Required Google branding is preserved and the overlays leave it space. Station faults are directory reports, not live availability.

Real public GoingElectric locations are visible by default. A group such as **4 × CCS** creates four virtual app slots. A fresh complete database read makes absent holds unreserved in BayReady. Select one plug and confirm a short hold to block the same slot for other BayReady users. Cancellation is owner-only and expiry uses database time. Physical occupancy and operator availability remain unverified; these numbers are virtual app references. Stale/failed booking reads disable writes. Reserved slots and server deadlines appear in Filters, including owned holds outside the viewport. Operator-approved inventory instead appears as one location marker: choose a bay, then an individual compatible plug before confirming a hold. All plugs on that physical bay share the reservation, while other bays remain independent.

Fictional Berlin test inventory is hidden behind **Show test location**. It has three bays and four plugs, with no public station/hardware mapping. The old simulator remains at `/reserve`, reachable through Activity navigation. Real Ecurious reservations still require the documented live integration.

## Driver profile and connector preference

`/profile` saves name, email, international phone, license plate, preferred connector and a fixed mock payment choice. Android uses SecureStore; the browser preview keeps preferences in memory only. No contact/plate data is uploaded, no real card input is present, and these details are not a verified login. The profile screen can be reopened from the map to edit preferences.

Your saved connector (`CCS`, `Type 2`, or `CHAdeMO`) automatically filters directory requests and registered plugs. Minimum power remains in the dropdown. Returning from profile editing preserves that manual setting. Before confirming a hold, the summary shows the selected plug, masked plate, chosen duration and mock payment. The database receives resource references, duration and request UUID, not the profile.

The Supabase project URL and public key are configured from root `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (the supplied legacy-anon `SUPABASE_API_KEY` also works). These are passed into public Expo settings; secret/service-role/management keys are rejected or stripped. Guest sessions persist in SecureStore. The hosted schema and anonymous-auth activation are still pending administrator access; follow [Supabase setup](../docs/SUPABASE.md) before expecting booking RPCs to work.

Requests go directly from the phone to GoingElectric. Results are cleared after roughly one hour and rechecked on return to the foreground; source and retrieval time stay visible. The directory key is available to the device for these requests and must be registered for this app. The map needs internet but works independently from the simulator API. [API documentation](https://www.goingelectric.de/stromtankstellen/api/docs/) and [usage terms](https://www.goingelectric.de/stromtankstellen/api/terms/).

`react-native-maps` and foreground `expo-location` are included in Expo Go. An independently built Android app needs a Google Maps SDK key/configuration; the GoingElectric directory key does not provide map tiles. [Expo map setup](https://docs.expo.dev/versions/latest/sdk/map-view/).

## Connection troubleshooting

If Expo loads but the app cannot reach the simulator, confirm both processes are running, check the API address, and allow local-network traffic through the laptop firewall if prompted. Venue Wi-Fi may isolate devices; a shared phone hotspot is an alternative. An Expo tunnel forwards Metro, not the separate simulator API, so a tunnel alone does not fix API access.

If Expo Go reports a version mismatch, install the matching SDK 58 Expo Go release from [Expo's download page](https://expo.dev/go). No Android Studio or native build is required for this starter.
