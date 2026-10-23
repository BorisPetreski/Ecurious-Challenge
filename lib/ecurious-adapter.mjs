/**
 * Boundary for the onsite integration, intentionally unimplemented.
 *
 * Implement these operations only after obtaining the actual API documentation,
 * authentication scheme, request/response schemas and hardware status mapping.
 * Never treat an uncertain command acknowledgement as proof of hardware state:
 * reconcile it with an authenticated status/event feed. Before raising a parking
 * barrier, require a fresh, trusted bay sensor reading that the bay is empty.
 *
 * The simulator's start-charge action does not deliver EVSE power. Actual charger
 * control and physical charging status need their documented integration too.
 */
export class EcuriousAdapter {
  async reserve() {
    throw new Error('EcuriousAdapter.reserve is not implemented: documented authentication, payloads and status mapping are required.');
  }

  async release() {
    throw new Error('EcuriousAdapter.release is not implemented: documented authentication, sensor interlock and acknowledgement reconciliation are required.');
  }

  async getStatus() {
    throw new Error('EcuriousAdapter.getStatus is not implemented: an authenticated documented hardware status feed is required.');
  }
}
