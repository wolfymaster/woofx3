import { describe, expect, it } from "bun:test";
import { COMPANION_DEFAULTS, RELAY_MAX_TICKETS } from "../config/companion";
import { BridgeOpens } from "./bridge-opens";

describe("BridgeOpens", () => {
  it("hands out permits up to the limit, then refuses and counts it", () => {
    const opens = new BridgeOpens(2);
    const first = opens.tryAcquire();
    const second = opens.tryAcquire();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(opens.tryAcquire()).toBeNull();
    expect(opens.status()).toEqual({ inUse: 2, limit: 2, refused: 1 });
    first?.release();
    expect(opens.tryAcquire()).not.toBeNull();
  });

  it("ignores a second release of one permit", () => {
    const opens = new BridgeOpens(2);
    const permit = opens.tryAcquire();
    opens.tryAcquire();
    permit?.release();
    permit?.release();
    expect(opens.status().inUse).toBe(1);
  });

  for (const limit of [0, RELAY_MAX_TICKETS + 1, 1.5]) {
    it(`refuses the limit ${limit}`, () => {
      expect(() => new BridgeOpens(limit)).toThrow("BridgeOpens: the limit");
    });
  }

  it("ships a default at or below the relay's ticket limit", () => {
    expect(COMPANION_DEFAULTS.maxBridgeOpens).toBeLessThanOrEqual(RELAY_MAX_TICKETS);
    expect(() => new BridgeOpens(COMPANION_DEFAULTS.maxBridgeOpens)).not.toThrow();
  });
});
