import type { LinksParams, ModerationConfig } from "@woofx3/api/moderation-config";
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

/** What `!permit` needs: a grant that answers how long it lasts. */
export interface LinkPermits {
  /** Seconds granted, or null when links are not being filtered, so a permit would mean nothing. */
  permit(platform: PlatformId, login: string): number | null;
}

/** Grants permits for as long as the running config's links rule says. */
export function linkPermits(config: { current(): ModerationConfig }, permits: PermitStore): LinkPermits {
  return {
    permit(platform, login) {
      const current = config.current();
      const links = current.rules.links;
      if (!current.enabled || links === undefined || !links.enabled) {
        return null;
      }
      // The config parser checked these params with the links filter's own parser.
      const { permitSeconds } = links.params as LinksParams;
      if (permitSeconds === 0) {
        return null;
      }
      permits.grant(platform, login, permitSeconds);
      return permitSeconds;
    },
  };
}
