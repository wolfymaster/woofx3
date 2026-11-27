import type { Meter, SharedLogger } from "@woofx3/common/logging";

/** The things this engine's api depends on and can honestly observe; a bounded attribute value. */
export const DEPENDENCIES = ["nats", "db", "barkloader", "convex_queue"] as const;
export type Dependency = (typeof DEPENDENCIES)[number];

/**
 * Whether a dependency is up right now. `null` means it cannot be told (not
 * configured, nothing to observe yet), in which case nothing is reported
 * rather than a guess. A probe that rejects is down.
 */
export type DependencyProbe = () => boolean | null | Promise<boolean | null>;

/**
 * `woofx3.dependency.up`: 1 or 0 per dependency, evaluated each time metrics
 * are collected. Each probe is one the api already trusts for its own
 * decisions (a db-proxy call, the NATS client's state, barkloader's heartbeat,
 * the event shipper's last POST), so the gauge cannot disagree with the engine.
 */
export function registerDependencyMetrics(
  meter: Meter,
  probes: Partial<Record<Dependency, DependencyProbe>>,
  logger: SharedLogger
): void {
  meter
    .createObservableGauge("woofx3.dependency.up", {
      description: "1 while a dependency is reachable and answering, else 0.",
      unit: "1",
    })
    .addCallback(async (result) => {
      await Promise.all(
        DEPENDENCIES.map(async (dependency) => {
          const probe = probes[dependency];
          if (probe === undefined) {
            return;
          }
          let up: boolean | null;
          try {
            up = await probe();
          } catch (err) {
            logger.debug("dependency probe failed; reporting it down", {
              dependency,
              error: err instanceof Error ? err.message : String(err),
            });
            up = false;
          }
          if (up !== null) {
            result.observe(up ? 1 : 0, { dependency });
          }
        })
      );
    });
}
