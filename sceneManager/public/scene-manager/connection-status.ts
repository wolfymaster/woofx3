// Single owner of the Disconnected banner.
//
// Two independent signals report on sceneManager's reachability: the
// SSE stream (event-source.ts) and the periodic session refresh
// (index.ts). Before this, each toggled the banner directly, so they
// could disagree -- the stream could reconnect and clear the banner
// while refresh was still failing, or refresh could succeed and clear
// a banner the stream had legitimately raised. Whichever fired last
// won, and a stale verdict could sit on screen for a full refresh
// interval.
//
// Here both report into one place and the banner shows unless every
// input is healthy. Renders only on transition, so a signal
// re-asserting a state it already holds costs nothing.

export type ConnectionInput = "stream" | "session";

export class ConnectionStatus {
  // The stream starts down by construction: nothing is connected until
  // event-source.ts opens it. The banner's own default is hidden, so a
  // normal load doesn't flash it -- this only means an initial connect
  // that never lands leaves the banner raised.
  private readonly unhealthy = new Set<ConnectionInput>(["stream"]);
  private lastRendered: boolean | null = null;

  constructor(private readonly render: (connected: boolean) => void) {}

  set(input: ConnectionInput, healthy: boolean): void {
    if (healthy) {
      this.unhealthy.delete(input);
    } else {
      this.unhealthy.add(input);
    }
    const connected = this.unhealthy.size === 0;
    if (connected === this.lastRendered) {
      return;
    }
    this.lastRendered = connected;
    this.render(connected);
  }

  get connected(): boolean {
    return this.unhealthy.size === 0;
  }
}
