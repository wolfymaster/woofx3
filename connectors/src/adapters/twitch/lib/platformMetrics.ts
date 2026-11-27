import type { Counter, Meter } from "@woofx3/common/logging";

/**
 * Whether the engine is connected to a platform, and how often it has had to
 * connect again. `up` is read at export time from the adapter's own readiness,
 * so it reflects what the connection is doing now, not the last event about it.
 */
export class PlatformConnectionMetrics {
  private readonly reconnects: Counter;
  private connections = 0;

  constructor(
    meter: Meter,
    private readonly platform: string,
    isUp: () => boolean
  ) {
    this.reconnects = meter.createCounter("woofx3.platform.reconnects", {
      description: "Connections to a platform made after the first one.",
      unit: "{reconnect}",
    });
    meter
      .createObservableGauge("woofx3.platform.connection.up", {
        description: "1 while every required platform subscription is confirmed, else 0.",
        unit: "1",
      })
      .addCallback((result) => {
        result.observe(isUp() ? 1 : 0, { platform: this.platform });
      });
  }

  /** Call each time a connection is established; every one after the first is a reconnect. */
  connected(): void {
    if (this.connections > 0) {
      this.reconnects.add(1, { platform: this.platform });
    }
    this.connections += 1;
  }
}
