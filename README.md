# BayReady hackathon starter

A local coding starter for the Ecurious challenge at WATT THE HACK on 24 October 2026. Rehearse a reservation cycle tonight, then replace the simulator with the documented Ecurious integration at the venue. The proposed focus is **no-shows and blocked bays**, with plate recognition in the required arrival flow.

## Start in one minute

Node 24 and npm are already installed on this Mac. There are no packages to download, build tools, accounts, or containers required for the simulator.

```sh
cd "/Users/borispetreski/Ecurious Challenge Hackathon"
npm run doctor
npm test
npm start
```

Open **http://127.0.0.1:3000**. Keep the terminal running; Ctrl+C stops the server. If port 3000 is busy, use `PORT=3001 npm start`. Alternatively, double-click `launch.command` on this Mac.

The demo runs entirely locally. Only the optional GoingElectric search makes an external request, after you explicitly submit an API key. Reservations and events are in memory and disappear when the server restarts.

## Rehearse the flow

Use a fictional plate such as `M-DEMO-42`. Reserve the demo bay, simulate the matching arrival, start simulated charging, simulate departure, then release the booking. Use the scenario controls to rehearse no-show expiry, an occupied bay, and a low-confidence plate. Every hardware and charging action in this starter is simulated.

The optional GoingElectric panel makes a direct request from the browser using an approved API key. Real results are discovery only: they are **not mapped to the Ecurious test hardware**. Default station cards are synthetic. Browser access, credentials, and the hardware mapping must be confirmed on site.

## Your preparation pack

- [Tomorrow's plan and team split](docs/TOMORROW.md): what matters, tonight's checklist, mentor questions, build order.
- [Integration guide](docs/INTEGRATION.md): architecture, API boundary, state rules, what to implement first at the venue.
- [Demo and pitch](docs/PITCH.md): a three-minute script, business hypothesis, judge questions.
- [Build log](docs/BUILD-LOG.md): record actual API calls, decisions, failures, and evidence as you work.
- [Original challenge brief](source/challenge-brief.pdf) and [extracted text](source/challenge-brief.txt).

## Where to code tomorrow

| File | Purpose |
| --- | --- |
| `lib/ecurious-adapter.mjs` | Deliberately unimplemented hardware boundary; fill from the on-site docs |
| `lib/` | Reservation logic and simulator |
| `server.mjs` | Local HTTP API and static files |
| `public/app.js` | UI behavior and direct GoingElectric search |
| `public/styles.css` | Responsive interface |
| `test/` | Meaningful lifecycle and API checks |

`ECURIOUS_MODE=live` deliberately refuses startup until the real integration has been implemented. The present starter cannot satisfy the challenge's required live hardware cycle. The GoingElectric integration also needs an approved key and a successful browser request before it can be counted as working.

## Stack choice

Node's HTTP server, native browser JavaScript, and Node's test runner keep setup short and work offline. A database, framework, payment integration, and custom camera recognition are unnecessary for the first live cycle. The camera and reservation hardware are provided by Ecurious.

Source material: [challenge brief](source/challenge-brief.pdf), [GoingElectric API documentation](https://www.goingelectric.de/stromtankstellen/api/docs/), and [GoingElectric API terms](https://www.goingelectric.de/stromtankstellen/api/terms/), checked 23 October 2026. The brief is reference material; the defaults and product choices in this repository are proposed team decisions.
