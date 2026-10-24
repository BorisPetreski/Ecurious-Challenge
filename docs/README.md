# BayReady documentation

Implementation snapshot: 24 October 2026. The source brief provides challenge requirements; it is not authorization to operate public infrastructure. The user has chosen an Android Expo app and shared application reservations. Physical integration is limited to the designated Ecurious hardware.

## Start here

| Need | Read |
| --- | --- |
| Understand the entire system and its boundaries | [System design](SYSTEM-DESIGN.md) |
| Run the app, configure services, or diagnose a failure | [Operations](OPERATIONS.md), then [mobile setup](../mobile/README.md) |
| Understand database tables, transactions and access | [Database design](DATABASE.md) |
| Apply the hosted Supabase setup | [Supabase setup](SUPABASE.md) |
| Implement a client or inspect requests and responses | [API reference](API.md) |
| Activate the guarded designated hardware workflow | [Hardware enrollment/setup](HARDWARE-SETUP.md), [blocked bays and no-shows](BAY-LIFECYCLE.md) |
| Test the selected barrier-only lock with a plate | [lock-0002 app walkthrough](LOCK-0002-WALKTHROUGH.md) |
| Understand scheduled booking, plate entry, accounts and session duration | [Scheduled sessions](SCHEDULED-SESSIONS.md) |
| Rehearse with different fictional cars and competing owners | [Multi-car Scenario lab](MULTI-CAR-SIMULATION.md) |
| Turn all PDF guiding questions into concrete implementation work | [Challenge workflow and suggestions](CHALLENGE-WORKFLOW.md) |
| Use native Ecurious OCR or an optional external model | [Plate integration](MODEL-INTEGRATION.md), [native API rehearsal](NATIVE-OCR-TEST.md) |
| Understand privacy controls, data rights and operator requirements | [Privacy implementation/readiness](PRIVACY.md) |
| Work on the real hardware integration | [Integration guide](INTEGRATION.md) and [observed Ecurious contract](ECURIOUS-API.md) |
| Check what was actually observed, tested or unsuccessful | [Build log](BUILD-LOG.md) |
| Prepare the team, demo or submission | [Team preparation](TOMORROW.md), [pitch](PITCH.md), [challenge brief](../source/challenge-brief.pdf) |
| Assess pricing and operator value | [Business model](BUSINESS-MODEL.md), [editable assumptions](business-model/assumptions.json), [scenario results](business-model/scenarios.csv) |

## How to read the status

- **Directory listing:** real GoingElectric location/type/power/count data, fetched directly by the device. It does not establish live occupancy.
- **App reservation:** a software hold exclusive to other BayReady users of the same booking resource. It does not operate a barrier or reserve a charger with its operator.
- **Hardware observation:** an authenticated, timestamped Ecurious read, with stale/offline state shown as unknown.
- **Simulation:** local inputs and virtual charging/barrier states used to rehearse the full lifecycle.
- **Proposed:** a product or deployment decision still to be agreed or implemented.

Hosted Supabase schema and sign-in are configured; follow the build log for exact applied versions and smoke-test evidence. A full physical charging cycle remains unverified.

The guarded hardware workflow is implemented with commands disabled by default. Its durable schema and private backend key are configured; real bay enrollment/interlocks remain separate activation requirements. No physical command or full live cycle has been verified.
