# BayReady demo runbook

Use the **Map → Audimax Munich (TUM)** flow from the pulled app for the short hardware demonstration. It uses **30-second windows** so the jury can see the outcome. The separate standard booking workflow uses ten-minute windows. The [three-minute pitch](PITCH.md) and [business model](BUSINESS-MODEL.md) provide the commercial story.

## Start on Android with Expo Go

Use Node 24+, an updated Expo Go app, and the same Wi-Fi for laptop and phone. On a fresh checkout:

```sh
git clone https://github.com/BorisPetreski/Ecurious-Challenge.git
cd Ecurious-Challenge
npm --prefix mobile ci
cp .env.example .env
```

On the existing laptop, keep its populated `.env`. Configure these values locally; never paste actual keys into documentation or commit them:

```dotenv
ECURIOUS_MODE=mock
PORT=3000
ECURIOUS_BASE_URL=https://parking-lock-service-production.up.railway.app
ECURIOUS_API_KEY=your-provided-challenge-key
ELECTRIC_API_KEY=your-approved-goingelectric-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-public-publishable-or-anon-key
```

`ECURIOUS_MODE=mock` describes the independent Node simulator; it does not disable the direct Audimax map commands. The launcher passes the challenge key to the phone as `EXPO_PUBLIC_AUDIMAX_API_KEY`, with an optional `EXPO_PUBLIC_AUDIMAX_API_KEY` override. **This direct demo credential is available in the Expo app.** Supabase secret/service-role credentials and access tokens are separate backend setup credentials, not phone settings. The already configured Supabase project supports the optional shared-booking demonstration; a new project needs the [Supabase setup](SUPABASE.md).

```sh
npm start
```

This launches the LAN simulator API on `PORT` and Expo Metro on 8081. Scan the terminal QR code in Expo Go. If the API port is occupied, use `PORT=3001 npm start`. If this project's API is already running separately, use `EXPO_PUBLIC_API_PORT=3001 npm run mobile -- --port 8081`, substituting its actual API port. Restart Expo after changing keys. Ctrl+C stops processes owned by that launcher. [Mobile troubleshooting](../mobile/README.md) covers address overrides.

## Prepare before presenting

- Save a **fictional test plate** in Profile and use the same demonstration plate with the organiser's camera test method. Contacts are optional; choose a connector and mock payment preference. Tap the BayReady brand to reopen Profile.
- Use the team's assigned **lock-0002**, a barrier-only rig with **no charger**. Coordinate one controller for this run; the direct map flow and the separate backend worker must not compete for it. One teammate presents the phone; another watches the rig and presents the demonstration plate.
- Keep Expo Go foregrounded on the map, the phone awake and the network connected. Scheduling, polling and expiry in this direct path depend on the running app. It is not a durable server scheduler or a shared multi-user reservation ledger.
- Open **Events & Nearby Charging → Use demo events → WATT THE HACK · TUM HackFest**, then the **Audimax TUM · Ecurious Live Hardware Bay** result. Alternatively use the map's purple **Audimax TUM · Ecurious Hardware** marker. The initial view is Munich; location is optional. Eventbrite events, when supplied by the configured account or curated IDs, are labelled separately from the seven fictional samples.
- In Audimax details use **Refresh hardware status**, select **lock-0002**, and open **Reserve now or book ahead**. Check that no prior local hold is active before starting. Its **Manage / Leave reservation** action opens the existing hold.

## Main demonstration: about 90 seconds

| Time | Presenter action | What to explain and show |
| --- | --- | --- |
| 0–15s | Show the full-screen map and saved connector in **Filters**. Open Audimax using the prepared Events selection or marker. | “A listed charger is useful only if its bay is usable when you arrive. Discovery and reservable hardware are separate.” |
| 15–30s | Choose **Now**, verify the displayed plate and **lock-0002**, then tap **Reserve free · 30 seconds (…)**. Point to the rig. | The phone sends a raise request and installs the plate whitelist. Observe the actual barrier: a successful HTTP response alone does not prove its position. |
| 30–55s | Present the matching demonstration plate to the built-in camera using the organiser's test procedure. Watch the barrier and the presence status. | “We use the hardware's plate recognition, without a custom AI model.” Show actual entry/lowering only if it occurs. A whitelist update does not inject a camera observation. |
| 55–75s | Show the occupied state after the provider reports `carPresence=occupied`. Reopen **Manage / Leave reservation** if needed. | The app stops the unused-arrival timeout when it sees occupancy. Occupancy alone is not proof of a plate match. This rig cannot demonstrate electrical charging. |
| 75–90s | After the test vehicle/target has left and the rig is clear, use **Leave Bay · Lower Barrier & Clear Whitelist**. Observe the resulting position and refreshed status. | Leaving sends policy cleanup and lowering requests, then clears this phone's hold. “The commercial promise is a usable arrival, with a short hold rather than unlimited empty capacity.” |

If the camera or telemetry does not complete the arrival step, say exactly what was observed and use the fallback below. Do not narrate a complete physical customer cycle from the countdown or success banner. Real raise/lower bench observations exist; the complete customer OCR/occupancy/departure cycle still needs its own observed evidence.

## Optional demonstrations

| Feature | How to show it | Current boundary |
| --- | --- | --- |
| No-show | In a separate empty-rig run, reserve **Now**, keep the map foregrounded, and let the 30 seconds expire without arrival. | The app requests whitelist clearing and unlocking. Watch the rig separately; expiry is not evidence that a bay is empty. |
| Extension | Before expiry tap **+ Add 30 seconds · €1 fee**. | Adds 30 seconds to this phone's deadline. The €1 is mock; there is no payment capture. |
| Calendar booking | Choose **Schedule**, set a Berlin arrival a minute or two ahead, and tap **Book ahead · Raises 30s before arrival (…)**. | The active app requests raising at T−30s; the unused deadline is T+30s. **Cancel Scheduled Booking** before activation clears the local booking without a movement request. |
| Events | Open **Events & Nearest Free Chargers**, browse the seven examples and the distance-ranked top five suggestions. | Event names/dates/crowds and static charger counts are fictional planning data. Some “free” counts are optimistic fallbacks. The Audimax card's displayed charger power/CCS label does not describe this barrier-only rig. Do not promise live vacancy from this list. |
| Map filters | Show **Minimum power** Any / 50+ kW / 150+ kW, profile connector, **Include reported faults**, **Show reserved**, **Show public chargers**, and optional **Show test location**. Use the location button, then **Search this area**. | GoingElectric supplies listings and fault reports, not live physical occupancy. The footer retains source/time links. Test inventory is fictional. |
| Shared public bookings | Select a real directory station, choose a listed app plug, use **Reserve now or book ahead**, then open **Bookings**. | Supabase shares app holds across accounts: standard Now is ten minutes free, extension +10 minutes €1 mock, scheduled €1 mock. These holds do not move public barriers or prove physical plug identity/vacancy. |
| Accounts and profile | Profile → **Sign in & account**; review local contact/connector/mock-payment choices. | Local profile and Supabase guest/email booking identity are separate. The direct Audimax plate is transmitted to the hardware provider's whitelist, unlike the older backend HMAC matching path. |
| Scenario lab | Profile → **Multi-car Scenario lab**. Pick a guided case and advance its virtual clock. | Three fictional drivers and seven scenarios rehearse race, recognition, no-show and blocked-bay behavior without physical commands. |
| Session screen | In the separate **Hardware test** workflow use **View session**, or start charging in the independent simulator. | `/session` shows that workflow's duration and available facts. It is not connected to the new direct Audimax local hold, and does not supply real kW/kWh. |
| Privacy controls | Profile → **Privacy & your data**. Show the local export/delete scopes and cloud booking export/erasure-request explanation. | Erasure intake is pending review, not automatic deletion. Operator notices, retention and rights handling still need completion; do not claim GDPR certification or compliance. |

The standard durable hardware workflow separately contains whole-bay allocation, authenticated intents, camera matching, scheduled fallback and mock refund rules. These do not automatically apply to the direct Audimax map path. See [system design](SYSTEM-DESIGN.md) and [scheduled sessions](SCHEDULED-SESSIONS.md) before demonstrating those controls.

## Fallback when the rig or network is unavailable

Keep the live failure visible, explain which request/observation is missing, and switch to **Profile → Multi-car Scenario lab**. Show the fictional happy path, no-show and blocked-bay recovery without issuing hardware commands. Public map browsing or Events can demonstrate discovery/planning if their sources are available. An earlier permitted rig recording should be introduced with its time and what it actually proves.

For the closing commercial sentence: **“We propose €29 per equipped bay per month to operators or hosts, hardware separately, and a pilot measured by successful arrivals, empty reserved minutes and net charging contribution.”** All fees and revenue figures are hypotheses; today's payments are mock. See [BUSINESS-MODEL.md](BUSINESS-MODEL.md) for the reproducible assumptions and the base case's negative result.
