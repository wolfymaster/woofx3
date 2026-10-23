import { RELAY_MAX_TICKETS } from "../config/companion";
import type { BridgeOpensStatus } from "./types";

/** One bridge open's hold on the cap. Releasing twice is harmless. */
export interface BridgeOpenPermit {
  release(): void;
}

/**
 * Caps bridge opens across the whole companion gateway, every adapter and
 * module session together. A permit is taken before the ticket exchange and
 * held until the ticket is spent or expired, mirroring the relay's own count
 * of outstanding tickets, so the gateway answers `busy` before the relay
 * answers 429.
 */
export class BridgeOpens {
  private inUse = 0;
  private refused = 0;

  constructor(readonly limit: number) {
    if (!(Number.isInteger(limit) && limit >= 1 && limit <= RELAY_MAX_TICKETS)) {
      throw new Error(`BridgeOpens: the limit must be a whole number from 1 to ${RELAY_MAX_TICKETS}, got ${limit}`);
    }
  }

  /** A permit, or null when the cap is reached. */
  tryAcquire(): BridgeOpenPermit | null {
    if (this.inUse >= this.limit) {
      this.refused++;
      return null;
    }
    this.inUse++;
    let held = true;
    return {
      release: () => {
        if (held) {
          held = false;
          this.inUse--;
        }
      },
    };
  }

  status(): BridgeOpensStatus {
    return { inUse: this.inUse, limit: this.limit, refused: this.refused };
  }
}
