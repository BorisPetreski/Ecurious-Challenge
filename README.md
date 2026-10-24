# BayReady

**Find a charger. Reserve the bay. Arrive with confidence.**

BayReady is an Android-first Expo prototype for the Ecurious WATT THE HACK challenge. It combines GoingElectric discovery, an Ecurious barrier demo, event-based charging planning, and shared app bookings.

**Start with the working map demo below.** [90-second demo guide](docs/DEMO.md) · [Three-minute pitch](docs/PITCH.md) · [Setup and frameworks](docs/SETUP.md) · [Complete system design](docs/SYSTEM-DESIGN.md)

## Run it

Requires **Node.js 24+**, npm, and **Expo Go on Android**. From this repository:

```sh
npm --prefix mobile ci  # first checkout only
npm start
```

Connect phone and laptop to the same Wi-Fi and scan the Expo QR code. The launcher starts Expo on port 8081 and the Node API on port 3000. If needed, use `PORT=3001 npm start`. Keep the map open during the timed hardware demo.

Existing local credentials stay in ignored root `.env`:

| Setting | Used for |
| --- | --- |
| `AUDIMAX_API_KEY` or existing `ECURIOUS_API_KEY` | Assigned Ecurious test hardware; launcher supplies the Audimax key to the phone |
| `ELECTRIC_API_KEY` | Direct GoingElectric map requests |
| `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` | Shared app bookings and guest/email accounts |
| `EVENTBRITE_PRIVATE_TOKEN` | Backend-only Eventbrite events |
| `EVENTBRITE_ORGANIZATION_ID` or `EVENTBRITE_EVENT_IDS` | Optional organization selection or comma-separated curated event IDs |

The pulled Audimax demo intentionally makes its test hardware key available on the phone. Eventbrite and Supabase administrative credentials stay backend-only. Do not commit `.env` or put actual credentials in screenshots. See [full setup](docs/SETUP.md) for exact mappings and optional backend configuration. No database migration is needed to demonstrate the direct Audimax map flow.

## Demonstrate the working hardware flow

1. Open **Profile**, save the test plate you will show to the camera, and choose a connector preference. Contact details are optional.
2. On **Map**, tap the purple **Audimax TUM** marker. Select **lock-0002 · ACTIVE DEMO**.
3. Open **Reserve now or book ahead → Now**, then **Reserve free · 30 seconds**. Show the physical barrier responding.
4. Present the matching plate to the onboard camera. The app has registered that plate in the hardware whitelist. When occupancy reports `occupied`, the unused-hold countdown stops.
5. Open **Manage / Leave reservation → Leave Bay · Lower Barrier & Clear Whitelist** to clear access and request lowering.

**Thirty seconds is the accelerated hackathon window.** This is a barrier-only rig, with no electricity delivered. A success message acknowledges the API request; observe the arm/status to confirm movement. This map flow uses a local device hold and phone timers, separately from the older database-backed Hardware screen.

## What else to show

| Feature | Where / what to demonstrate |
| --- | --- |
| Real charger discovery | Map: GoingElectric locations, connectors, power, source attribution and station links |
| Personalised filters | Profile connector preference; map minimum-power, fault and reserved filters |
| Event planner | **Events**: Eventbrite feed when available, explicitly labelled sample events, nearby charging suggestions, event links |
| No-show handling | Reserve without arrival; the 30-second foreground timer invokes whitelist cleanup and lowering |
| More arrival time | **Add 30 seconds · €1 fee** — mock payment |
| Book ahead | Calendar/time picker; the direct demo requests protection at arrival−30 seconds and expires at arrival+30 seconds |
| Shared app bookings | Public directory plug choices use Supabase holds; these do not operate public barriers |
| Multiple cars and blocked bays | **Profile → Multi-car Scenario lab**: fictional wrong-car, race, blocked-bay, fallback and refund cases |
| Session information | Older **Hardware → View session** and simulator screens; these are separate from the direct Audimax map hold |
| Privacy controls | **Profile → Privacy & your data**: stated local/cloud export and deletion/request scopes |

Eventbrite's API does not provide unrestricted public city search. The integration reads an accessible organization or configured event IDs, and keeps only eligible events near Munich. An empty live feed stays empty until a source has matching events; **Use demo events** explicitly switches to the sample dataset. Nearby suggestions are not proof of physical vacancy. See [API reference](docs/API.md) and [demo guide](docs/DEMO.md).

## Stack

| Layer | Framework / service |
| --- | --- |
| Mobile | Expo SDK 58, React Native 0.88, React 19.3, TypeScript 6, Expo Router |
| Maps and device features | react-native-maps, Expo Location, Expo SecureStore, native date/time pickers through `@expo/ui` |
| Local API | Node.js 24, native HTTP/fetch, separate simulation and hardware modules |
| Shared storage and identity | Supabase PostgreSQL, Auth and Row Level Security |
| Integrations | GoingElectric listings, Ecurious lock/whitelist/occupancy, Eventbrite organization/curated events |



## Documentation

| Need | Read |
| --- | --- |
| Present the app | [Demo runbook](docs/DEMO.md), [three-minute pitch and judge Q&A](docs/PITCH.md) |
| Install and understand the stack | [Setup/frameworks](docs/SETUP.md) |
| Understand architecture and data flows | [System design](docs/SYSTEM-DESIGN.md), [integration guide](docs/INTEGRATION.md) |
| Inspect contracts and persistence | [API](docs/API.md), [database](docs/DATABASE.md), [Supabase](docs/SUPABASE.md) |
| Explain privacy and remaining work | [Privacy](docs/PRIVACY.md), [system boundaries](docs/SYSTEM-DESIGN.md) |
| Cover the challenge questions | [All 20 guiding questions and implementation suggestions](docs/CHALLENGE-WORKFLOW.md) |
| Review evidence and limitations | [Build log](docs/BUILD-LOG.md), [documentation index](docs/README.md) |

Useful development commands: `npm run mobile` (Expo only), `npm run server:lan` (API only), `npm run check`, `npm test`, and `npm run hardware:inspect` (read-only diagnostics). The longer-lived Hardware/Supabase flow and the independent simulator remain documented, but the **Audimax map path is the primary presentation flow**.
