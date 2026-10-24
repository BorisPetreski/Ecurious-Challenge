# BayReady mobile

Expo SDK 58, React Native, Expo Router, and TypeScript. Android with Expo Go is the primary development target. Hardware and charging are simulated through the existing Node backend; no Ecurious credentials or live commands are implemented.

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

Variables beginning with `EXPO_PUBLIC_` are included in the app. Use them for addresses only; keep hardware authentication secrets on the backend. The Map tab displays the official GoingElectric website; the native reservation screen's station examples remain synthetic and clearly labelled.

## GoingElectric map

Open the **Map** tab to browse the official [GoingElectric charging map](https://www.goingelectric.de/stromtankstellen/) inside the app. This is the original website in an Expo-compatible native WebView, so no GoingElectric API key is needed. Its search, filters, map gestures, and station pages belong to GoingElectric; source attribution stays visible. The native toolbar provides back, reload, and open-in-browser controls, with retry states for connection failures.

The map needs an internet connection but does not depend on the laptop simulator API. Public stations are discovery only; reservations still cover the demo bay. The app does not scrape the website or extract its station records. A custom native map/data integration would use the documented API with approved credentials later. Website behavior, cookies, and any location prompts remain part of the GoingElectric browsing experience.

## Connection troubleshooting

If Expo loads but the app cannot reach the simulator, confirm both processes are running, check the API address, and allow local-network traffic through the laptop firewall if prompted. Venue Wi-Fi may isolate devices; a shared phone hotspot is an alternative. An Expo tunnel forwards Metro, not the separate simulator API, so a tunnel alone does not fix API access.

If Expo Go reports a version mismatch, install the matching SDK 58 Expo Go release from [Expo's download page](https://expo.dev/go). No Android Studio or native build is required for this starter.
