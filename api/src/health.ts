/**
 * The body of `GET /health`: a liveness answer plus descriptive facts about
 * this engine.
 *
 * The endpoint is public and unauthenticated, so everything here must be safe
 * for anyone to read: identifiers and timings only, never configuration,
 * hostnames of internal services, or anything derived from a secret.
 */
export interface Health {
  status: "ok";
  /** The name the provisioner gave this engine (`WOOFX3_ENGINE_NAME`); null when unset. */
  name: string | null;
  /** The running release (`WOOFX3_VERSION`); see UNVERSIONED. */
  version: string;
  /**
   * When this api process started, as ISO-8601. A deploy starts a new process,
   * so this is the time of the last deploy or the last restart, whichever is later.
   */
  startedAt: string;
  uptimeSeconds: number;
}

export interface HealthFacts {
  name: string | null;
  version: string;
  /** Wall-clock start of this process, epoch milliseconds. */
  startedAt: number;
}

/**
 * `uptimeSeconds` comes from a monotonic clock, not from subtracting
 * `startedAt` from the wall clock, so a clock step after boot cannot make it
 * negative or jump.
 */
export function describeHealth(facts: HealthFacts, uptimeSeconds: number): Health {
  return {
    status: "ok",
    name: facts.name,
    version: facts.version,
    startedAt: new Date(facts.startedAt).toISOString(),
    uptimeSeconds: Math.floor(uptimeSeconds),
  };
}
