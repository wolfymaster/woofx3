import { describe, expect, it } from "bun:test";
import { ConnectionStatus } from "../../public/scene-manager/connection-status";

function track() {
  const rendered: boolean[] = [];
  return { rendered, status: new ConnectionStatus((c) => rendered.push(c)) };
}

describe("ConnectionStatus", () => {
  it("starts with the stream down", () => {
    const { status } = track();
    expect(status.connected).toBe(false);
  });

  it("reports connected once every input is healthy", () => {
    const { rendered, status } = track();
    status.set("stream", true);
    expect(status.connected).toBe(true);
    expect(rendered).toEqual([true]);
  });

  it("keeps the banner up while any single input is unhealthy", () => {
    // The bug this pins: the SSE stream reconnecting used to clear the
    // banner outright, hiding a session refresh that was still failing.
    const { rendered, status } = track();
    status.set("stream", true);
    status.set("session", false);
    expect(status.connected).toBe(false);

    status.set("stream", false);
    status.set("stream", true);
    expect(status.connected).toBe(false);
    expect(rendered).toEqual([true, false]);
  });

  it("clears only when the last unhealthy input recovers", () => {
    const { rendered, status } = track();
    status.set("session", false);
    status.set("stream", true);
    expect(status.connected).toBe(false);
    status.set("session", true);
    expect(status.connected).toBe(true);
    expect(rendered).toEqual([false, true]);
  });

  it("renders only on transitions", () => {
    const { rendered, status } = track();
    status.set("stream", true);
    status.set("stream", true);
    status.set("session", true);
    expect(rendered).toEqual([true]);
  });
});
