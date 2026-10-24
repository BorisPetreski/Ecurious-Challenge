# Ecurious Challenge

BayReady is an Expo mobile starter for the Ecurious WATT THE HACK challenge on 24 October 2026. The primary target is Android with Expo Go. The proposed mission areas are no-shows and blocked bays; confirm final product scope with your team.

## Start the mobile app

Node 24+ and npm are required. Dependencies are already installed in the current workspace. On a fresh checkout:

```sh
git clone https://github.com/BorisPetreski/Ecurious-Challenge.git
cd Ecurious-Challenge
npm --prefix mobile ci
```

From the project root:

```sh
npm start
```

This runs both the local reservation API on port 3000 and Expo Metro on port 8081. Update Expo Go on your Android phone, connect the phone and laptop to the same Wi-Fi, and scan the terminal QR code in Expo Go. Ctrl+C stops both processes. If API port 3000 is busy, use `PORT=3001 npm start`.

The mobile app uses Expo SDK 58, React Native, Expo Router, and TypeScript. It connects to the existing simulator over the local network. See [mobile setup and troubleshooting](mobile/README.md) for API address overrides and connection details.

## Current behavior

- Map tab displaying GoingElectric's official interactive website directly, without an API key.
- Native reservation screen and activity timeline backed by the local simulator.
- Fictional station cards with one reservable demo bay.
- Reserve, simulated plate check, simulated charging, departure, and release.
- No-show expiry, blocked-bay scenarios, low-confidence recognition, and capability-driven controls.
- Typed API client with bounded requests and polling while the app is active.

All hardware and charging actions remain simulated. Real Ecurious integration is deliberately unimplemented and live mode refuses startup. The Map tab loads the official GoingElectric website in a native WebView, retaining its search, filters, source attribution, and station pages. A custom native map using GoingElectric's API remains future work and needs approved API access. Directory stations never automatically map to the designated Ecurious test bay.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm start` | Expo and the phone-accessible simulator API together |
| `npm run mobile` | Expo only |
| `npm run server:lan` | Simulator API only, reachable from a phone on the LAN |
| `npm run server` | Original browser demo and API on loopback |
| `npm run dev` | Watch and restart the standalone backend |
| `npm test` | Backend lifecycle and HTTP checks |
| `npm run check` | JavaScript syntax and native TypeScript checks |
| `npm run mobile:doctor` | Expo project checks |
| `npm run doctor` | Backend setup and available-port check |

The standalone browser demo is available at http://127.0.0.1:3000 while the API runs. Optional backend settings go in `.env`, copied from `.env.example`. Mobile address overrides go in `mobile/.env`, copied from `mobile/.env.example`. Both actual environment files are ignored by Git. Never place hardware secrets in an `EXPO_PUBLIC_` variable; those values are bundled into the app.

## Where to develop

| Path | Purpose |
| --- | --- |
| `mobile/src/app/` | Native screens and navigation |
| `mobile/src/components/` | Shared mobile UI and state provider |
| `mobile/src/hooks/use-reservation.ts` | Foreground polling and booking actions |
| `mobile/src/lib/reservation-api.ts` | Typed client and API address selection |
| `mobile/app.json` | Expo app configuration |
| `server.mjs` and `lib/simulator.mjs` | Local API and reservation rules |
| `lib/ecurious-adapter.mjs` | Real hardware boundary to implement from supplied documentation |
| `public/` | Original browser prototype |

## Team and submission references

- [Preparation plan and team formation](docs/TOMORROW.md).
- [Architecture and integration guide](docs/INTEGRATION.md).
- [Demo and pitch rehearsal](docs/PITCH.md).
- [Build log and evidence checklist](docs/BUILD-LOG.md).
- [Original challenge brief](source/challenge-brief.pdf) and [extracted text](source/challenge-brief.txt).

The repository is [BorisPetreski/Ecurious-Challenge](https://github.com/BorisPetreski/Ecurious-Challenge). The user manages Git; no push is performed by the setup scripts. Keep `.env`, private runtime data, real plates, and camera captures out of commits. The scripts do not create cloud builds, publish an app, or configure a production backend.

## Integration priorities

Obtain the actual Ecurious API documentation, credentials, designated bay ID, status/event semantics, and accepted charging evidence. Connect one full real reservation cycle before adding extra features. A polished app is optional in the brief; a working hardware integration is required for top ranks.

Source references: [GoingElectric API documentation](https://www.goingelectric.de/stromtankstellen/api/docs/), [GoingElectric API terms](https://www.goingelectric.de/stromtankstellen/api/terms/), and [Expo documentation](https://docs.expo.dev/). Product defaults and hypothetical pricing remain proposals for the team.
