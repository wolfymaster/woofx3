import { describe, expect, it } from "bun:test";
import {
  ALWAYS_PROBE,
  BroadcastReconnectCoordinator,
  createReconnectCoordinator,
  type BroadcastLike,
} from "../../public/scene-manager/reconnect-coordinator";

/** In-memory stand-in for BroadcastChannel: every open channel on the
 *  same bus receives what any other posts, and never its own message
 *  (matching real BroadcastChannel semantics). */
class FakeBus {
  private readonly channels: FakeChannel[] = [];

  open(): FakeChannel {
    const channel = new FakeChannel(this);
    this.channels.push(channel);
    return channel;
  }

  deliver(from: FakeChannel, message: unknown): void {
    for (const channel of this.channels) {
      if (channel !== from && !channel.closed) {
        channel.onmessage?.({ data: message });
      }
    }
  }
}

class FakeChannel implements BroadcastLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  constructor(private readonly bus: FakeBus) {}

  postMessage(message: unknown): void {
    this.bus.deliver(this, message);
  }

  close(): void {
    this.closed = true;
  }
}

function makeCoordinator(bus: FakeBus, peerId: string, now: () => number) {
  return new BroadcastReconnectCoordinator({
    channel: bus.open(),
    peerId,
    now,
    heartbeatMs: 1_000_000, // manual control; the interval never fires in tests
    peerTtlMs: 5_000,
  });
}

describe("BroadcastReconnectCoordinator", () => {
  it("probes when it has heard no peers (fail-open)", () => {
    const bus = new FakeBus();
    const solo = makeCoordinator(bus, "bbb", () => 0);
    expect(solo.shouldProbe()).toBe(true);
    solo.stop();
  });

  it("elects the lowest peer id as the only prober", () => {
    const bus = new FakeBus();
    let clock = 0;
    const low = makeCoordinator(bus, "aaa", () => clock);
    const high = makeCoordinator(bus, "bbb", () => clock);

    // Both drop; each announces itself, so each learns of the other.
    low.onDisconnected();
    high.onDisconnected();

    expect(low.shouldProbe()).toBe(true);
    expect(high.shouldProbe()).toBe(false);

    low.stop();
    high.stop();
  });

  it("hands leadership over once the elected prober stops heartbeating", () => {
    const bus = new FakeBus();
    let clock = 0;
    const low = makeCoordinator(bus, "aaa", () => clock);
    const high = makeCoordinator(bus, "bbb", () => clock);

    low.onDisconnected();
    high.onDisconnected();
    expect(high.shouldProbe()).toBe(false);

    // The leader's page goes away: no further heartbeats. Once its
    // entry ages past the TTL, the survivor must take over rather than
    // sit silent forever.
    clock += 6_000;
    expect(high.shouldProbe()).toBe(true);

    low.stop();
    high.stop();
  });

  it("notifies peers when this instance reaches the server", () => {
    const bus = new FakeBus();
    let clock = 0;
    const a = makeCoordinator(bus, "aaa", () => clock);
    const b = makeCoordinator(bus, "bbb", () => clock);

    let woke = 0;
    b.onPeerConnected(() => {
      woke += 1;
    });

    a.onConnected();
    expect(woke).toBe(1);

    a.stop();
    b.stop();
  });

  it("relays a reload request to every sibling overlay", () => {
    // The fallback when sceneManager cannot reach the overlays itself
    // (no obs-websocket, or an overlay OBS doesn't know about). Note
    // this path needs no network: a sibling whose own session is dead
    // still gets told, because BroadcastChannel is browser IPC.
    const bus = new FakeBus();
    const a = makeCoordinator(bus, "aaa", () => 0);
    const b = makeCoordinator(bus, "bbb", () => 0);
    const c = makeCoordinator(bus, "ccc", () => 0);

    let bReloads = 0;
    let cReloads = 0;
    b.onPeerReload(() => {
      bReloads += 1;
    });
    c.onPeerReload(() => {
      cReloads += 1;
    });

    a.requestPeerReload();
    expect(bReloads).toBe(1);
    expect(cReloads).toBe(1);

    a.stop();
    b.stop();
    c.stop();
  });

  it("does not deliver a reload back to the overlay that sent it", () => {
    // Receivers reload without rebroadcasting, and the sender never
    // hears itself -- together that is what keeps a relay from turning
    // into a reload storm across every open overlay.
    const bus = new FakeBus();
    const a = makeCoordinator(bus, "aaa", () => 0);
    let selfReloads = 0;
    a.onPeerReload(() => {
      selfReloads += 1;
    });
    a.requestPeerReload();
    expect(selfReloads).toBe(0);
    a.stop();
  });

  it("does not confuse a reload request with a peer coming back up", () => {
    const bus = new FakeBus();
    const a = makeCoordinator(bus, "aaa", () => 0);
    const b = makeCoordinator(bus, "bbb", () => 0);
    let woke = 0;
    let reloads = 0;
    b.onPeerConnected(() => {
      woke += 1;
    });
    b.onPeerReload(() => {
      reloads += 1;
    });

    a.requestPeerReload();
    expect(reloads).toBe(1);
    expect(woke).toBe(0);

    a.onConnected();
    expect(woke).toBe(1);
    expect(reloads).toBe(1);

    a.stop();
    b.stop();
  });

  it("ignores malformed messages from the channel", () => {
    const bus = new FakeBus();
    const channel = bus.open();
    const coordinator = new BroadcastReconnectCoordinator({ channel, peerId: "aaa", now: () => 0 });
    let woke = 0;
    coordinator.onPeerConnected(() => {
      woke += 1;
    });

    channel.onmessage?.({ data: null });
    channel.onmessage?.({ data: "not-an-object" });
    channel.onmessage?.({ data: { t: "alive" } });
    expect(woke).toBe(0);
    expect(coordinator.shouldProbe()).toBe(true);

    coordinator.stop();
  });

  it("stops probing and closes the channel on stop()", () => {
    const bus = new FakeBus();
    const channel = bus.open();
    const coordinator = new BroadcastReconnectCoordinator({ channel, peerId: "aaa", now: () => 0 });
    coordinator.stop();
    expect(channel.closed).toBe(true);
    expect(coordinator.shouldProbe()).toBe(false);
  });

  it("falls back to the fail-open coordinator with no BroadcastChannel", () => {
    const original = globalThis.BroadcastChannel;
    // @ts-expect-error deliberately removing the global for this case
    delete globalThis.BroadcastChannel;
    try {
      expect(createReconnectCoordinator()).toBe(ALWAYS_PROBE);
    } finally {
      globalThis.BroadcastChannel = original;
    }
  });
});

describe("ALWAYS_PROBE", () => {
  it("always allows a probe", () => {
    expect(ALWAYS_PROBE.shouldProbe()).toBe(true);
    ALWAYS_PROBE.onDisconnected();
    ALWAYS_PROBE.onConnected();
    ALWAYS_PROBE.stop();
    expect(ALWAYS_PROBE.shouldProbe()).toBe(true);
  });
});
