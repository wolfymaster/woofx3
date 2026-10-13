import type { EngineCapability, Woofx3EngineApi } from "@woofx3/api";
import {
  type EntitlementGrant,
  EntitlementGrantError,
  type EntitlementPublicKeys,
  verifyEntitlementGrant,
} from "./entitlement-grant";

/** Engine setting holding the current grant, as the signer sent it. */
export const ENTITLEMENT_GRANT_SETTING = "entitlements.grant";

/**
 * The gateable capability each RPC method belongs to. A method listed here
 * is refused while its capability is withheld. Every value must be in
 * GATEABLE_ENGINE_CAPABILITIES; a test holds that.
 */
export const GATED_METHODS: Partial<Record<keyof Woofx3EngineApi, EngineCapability>> = {};

/** Thrown by a gated method whose capability this engine is not entitled to. */
export class EntitlementError extends Error {
  constructor(readonly capability: string) {
    super(`${capability} isn't enabled for this engine`);
    this.name = "EntitlementError";
  }
}

export interface EntitlementsDeps {
  /** Null on an engine with no entitlement keys configured: nothing is withheld. */
  keys: EntitlementPublicKeys | null;
  /** The engine's name, which a grant must be addressed to. Required with keys. */
  audience: string | null;
  /** Capabilities that need a grant on a governed engine. */
  gateable: ReadonlySet<string>;
  readGrant(): Promise<string | null>;
  writeGrant(token: string): Promise<void>;
  /** Milliseconds since the epoch. */
  now(): number;
}

interface HeldGrant {
  token: string;
  grant: EntitlementGrant;
}

/**
 * Which gateable features this engine may use.
 *
 * An engine with no entitlement keys is ungoverned and withholds nothing:
 * that is every self-hosted engine. A governed engine withholds each gateable
 * capability its current, unexpired grant does not list; with no grant, or an
 * expired one, it withholds them all.
 *
 * The api is the only writer of the grant setting, so the grant is read from
 * the database once and then kept in memory. Grants are applied one at a
 * time, so two pushes cannot both pass the ordering check.
 */
export class Entitlements {
  private held: Promise<HeldGrant | null> | null = null;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: EntitlementsDeps) {
    if (deps.keys !== null && !deps.audience) {
      throw new Error("Entitlement keys are configured but WOOFX3_ENGINE_NAME is not; grants name the engine");
    }
  }

  get governed(): boolean {
    return this.deps.keys !== null;
  }

  /** Gateable capabilities from `supported` this engine may not use, sorted. */
  async withheld(supported: readonly string[]): Promise<string[]> {
    if (!this.governed) {
      return [];
    }
    const held = await this.current();
    const granted =
      held !== null && held.grant.exp * 1000 > this.deps.now() ? new Set(held.grant.grants) : new Set<string>();
    return supported.filter((id) => this.deps.gateable.has(id) && !granted.has(id)).sort();
  }

  /** Throws EntitlementError when `capability` is withheld. */
  async require(capability: string): Promise<void> {
    if ((await this.withheld([capability])).length > 0) {
      throw new EntitlementError(capability);
    }
  }

  /**
   * Verifies and stores a grant. Refuses one that is expired, addressed to
   * another engine, or older than the grant held, so a grant from before a
   * downgrade cannot be replayed. Re-sending the held grant is accepted.
   */
  async setGrant(token: string): Promise<{ seq: number }> {
    const keys = this.deps.keys;
    const audience = this.deps.audience;
    if (keys === null || !audience) {
      throw new EntitlementGrantError("This engine has no entitlement keys configured and takes no grants");
    }
    const apply = async (): Promise<{ seq: number }> => {
      const grant = await verifyEntitlementGrant(token, keys, audience);
      if (grant.exp * 1000 <= this.deps.now()) {
        throw new EntitlementGrantError("Grant has expired");
      }
      const held = await this.current();
      if (held !== null) {
        if (grant.seq < held.grant.seq) {
          throw new EntitlementGrantError(`Grant ${grant.seq} is older than the held grant ${held.grant.seq}`);
        }
        if (grant.seq === held.grant.seq) {
          if (token.trim() !== held.token) {
            throw new EntitlementGrantError(`A different grant ${grant.seq} is already held`);
          }
          return { seq: grant.seq };
        }
      }
      await this.deps.writeGrant(token.trim());
      this.held = Promise.resolve({ token: token.trim(), grant });
      return { seq: grant.seq };
    };
    const result = this.writes.then(apply, apply);
    this.writes = result.catch(() => undefined);
    return result;
  }

  private current(): Promise<HeldGrant | null> {
    if (this.held === null) {
      this.held = this.load();
      // A failed read is retried on the next call instead of being cached.
      this.held.catch(() => {
        this.held = null;
      });
    }
    return this.held;
  }

  /**
   * The stored grant, or null when there is none or it no longer verifies,
   * e.g. after its signing key was rotated out. Either way the engine
   * withholds every gateable capability until the next grant arrives.
   */
  private async load(): Promise<HeldGrant | null> {
    const keys = this.deps.keys;
    const audience = this.deps.audience;
    const token = (await this.deps.readGrant())?.trim();
    if (!token || keys === null || !audience) {
      return null;
    }
    try {
      return { token, grant: await verifyEntitlementGrant(token, keys, audience) };
    } catch (err) {
      if (err instanceof EntitlementGrantError) {
        return null;
      }
      throw err;
    }
  }
}
