# OpenAPI and Swagger UI

BayReady includes interactive Swagger UI and checked-in OpenAPI 3.0.3 specifications. Run the local API, then open **[http://localhost:3001/docs](http://localhost:3001/docs)**:

```sh
PORT=3001 npm run server
```

If `npm start` already runs the API on port 3000, use `http://localhost:3000/docs` instead. The documentation uses the same server as the API.

## Choose the API

Use the Swagger UI selector to switch between two separate contracts:

| Specification | What it covers | Download / import |
| --- | --- | --- |
| **BayReady backend** | Simulator lifecycle, multi-car scenarios, Eventbrite feed, hardware observations, database-backed hardware booking intents and plate callback | [`openapi.json`](openapi.json), served at `/api/openapi.json` |
| **Ecurious assigned test hardware** | Upstream assigned-lock list/status, latest camera OCR, raise/lower commands and plate whitelist used by the Audimax map flow | [`openapi-ecurious.json`](openapi-ecurious.json), served at `/api/openapi-ecurious.json` |

Both JSON files can be imported into Postman or an OpenAPI-compatible client generator. The upstream specification is BayReady's documented integration subset, based on the source and recorded observations; it is not an official Ecurious specification.

## Try a complete simulated reservation

In **BayReady backend**, expand an operation, select **Try it out**, and execute these requests in order. No API key or account is needed for this independent, in-memory simulator.

| Step | Operation | JSON body |
| --- | --- | --- |
| Reset | `POST /api/actions` | `{"action":"reset"}` |
| Reserve | `POST /api/reservations` | `{"plate":"DEMO42","holdMinutes":10}` |
| Matching arrival | `POST /api/actions` | `{"action":"arrive","plate":"DEMO42","confidence":0.99}` |
| Start simulated charging | `POST /api/actions` | `{"action":"start-charge"}` |
| Depart | `POST /api/actions` | `{"action":"depart"}` |
| Release | `POST /api/actions` | `{"action":"release"}` |

`GET /api/state` shows the resulting bay, reservation, capabilities and event history. `GET /api/simulation` and `POST /api/simulation/actions` operate the separate multi-car lab. These operations do not command the physical test rig or share Supabase directory holds.

`GET /api/events` reads the configured Eventbrite organization/curated feed. Eventbrite credentials stay in the backend environment; Swagger does not need that token. The mobile **Use demo events** choice is a separate presentation dataset, not a successful live Eventbrite response.

## Authentication and the hardware demo

**BayReady backend:** protected `/api/hardware/slots`, `/api/hardware/bookings` and `/api/hardware/actions` operations use a signed-in Supabase access JWT. Select **Authorize** and enter the JWT token value, without a `Bearer ` prefix; Swagger adds that prefix. Supply bay/connector IDs from the registered inventory. The `/api/integrations/plate-recognition` callback uses its own configured vision integration bearer token, not the driver's Supabase token. Quotes and basic read-only observations are public; configured owner snapshots may require authentication.

**Ecurious assigned test hardware:** select the Ecurious specification and authorize with the assigned team key. The current Audimax phone flow uses the `apiKey` query parameter; the Node adapter uses the alternative `X-API-Key` header. Choose one authentication method. The specification contains no credentials. Requests target the Ecurious Railway service directly, so browser execution also depends on the provider's CORS policy; Swagger's generated curl command uses the same documented contract.

For the designated **lock-0002** demo, the app's request sequence is:

1. `POST /api/v1/locks/lock-0002/lock` with no body, then `POST .../whitelist` with `{"plates":["DEMO42"]}` using the actual profile/test plate when demonstrating.
2. The onboard camera can lower the barrier for a matching whitelisted plate; `GET .../plate/latest` retrieves its latest OCR result separately.
3. Leaving sends `POST .../whitelist` with `{"plates":[]}`, then `POST .../unlock` with no body.

These are real device commands on the assigned barrier-only rig. They acknowledge requests; inspect the device/status to confirm movement. Raise and whitelist changes are separate requests, with no atomic booking or provider-side booking expiry. The current Audimax timer and hold are local to the phone; the database-backed Node hardware workflow is a separate path. See the [demo runbook](DEMO.md), [current system design](SYSTEM-DESIGN.md) and [observed upstream contract](ECURIOUS-API.md).

## Service boundaries

- **Supabase** provides Auth, PostgreSQL and RPCs for directory software holds and registered bay allocation. Those direct client calls are documented in [database design](DATABASE.md) and [Supabase setup](SUPABASE.md); they are not invented Node REST endpoints in this specification.
- **GoingElectric** is requested directly by the mobile app for directory listings. Listed plug counts do not establish physical vacancy or an Ecurious hardware mapping.
- **Ecurious** supplies barriers, occupancy reports and OCR/whitelist access; this API does not establish electricity delivery or payment processing.
- **Reservation fees and charging in the simulator are mock.** The OpenAPI examples do not charge money.

The specifications describe current source contracts. Keep them updated alongside [API.md](API.md) when routes, request bodies, authentication or response schemas change.
