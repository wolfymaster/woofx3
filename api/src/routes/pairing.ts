import type {
  DecidePairingRequest,
  DecidePairingResponse,
  ListPendingPairingsResponse,
  LookupPairingRequest,
  LookupPairingResponse,
} from "@woofx3/api/pairing";
import { routeModule } from "./context";

/**
 * Browser pairing for an approver, any client of this engine; the pairings
 * themselves are `PairingRegistry`. An engine that does not pair has none
 * and answers `not_available`.
 */
export const pairingRoutes = routeModule({
  async lookupPairing(request: LookupPairingRequest): Promise<LookupPairingResponse> {
    if (!this.pairingRegistry) {
      return { ok: false, code: "not_available" };
    }
    return this.pairingRegistry.lookup(request);
  },

  /** `context` comes from the session, which supplies the deciding client. */
  async decidePairing(request: DecidePairingRequest, context?: { clientId: string }): Promise<DecidePairingResponse> {
    if (!this.pairingRegistry) {
      return { ok: false, code: "not_available" };
    }
    if (!context) {
      throw new Error("decidePairing needs the deciding client's session");
    }
    return this.pairingRegistry.decide(request, context.clientId);
  },

  async listPendingPairings(): Promise<ListPendingPairingsResponse> {
    if (!this.pairingRegistry) {
      return { ok: false, code: "not_available" };
    }
    return this.pairingRegistry.listPending();
  },
});
