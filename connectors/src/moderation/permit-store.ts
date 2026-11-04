import type { PlatformId } from "@woofx3/api/platform-gateway";
import { BoundedMap } from "../chat/bounded-map";
import type { Clock } from "../host/deps";
import type { PermitStore } from "./types";

/**
 * Permits in memory, keyed by platform and login because `!permit` names a
 * login and a permit lasts seconds, too short for a rename to matter. Lost
 * on restart by design. Bounded, the least recently granted going first.
 */
export class MemoryPermitStore implements PermitStore {
  private readonly expiries: BoundedMap<string, number>;

  constructor(
    capacity: number,
    private readonly clock: Clock
  ) {
    this.expiries = new BoundedMap({ capacity }, clock);
  }

  grant(platform: PlatformId, login: string, seconds: number): void {
    this.expiries.set(key(platform, login), this.clock.now() + seconds * 1_000);
  }

  isPermitted(platform: PlatformId, login: string): boolean {
    const expiresAt = this.expiries.get(key(platform, login));
    if (expiresAt === undefined) {
      return false;
    }
    if (this.clock.now() >= expiresAt) {
      this.expiries.delete(key(platform, login));
      return false;
    }
    return true;
  }
}

function key(platform: PlatformId, login: string): string {
  return `${platform}:${login.toLowerCase()}`;
}
