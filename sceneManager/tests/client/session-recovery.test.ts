import { describe, expect, it } from "bun:test";
import { SceneEventSource } from "../../public/scene-manager/event-source";
import { ALWAYS_PROBE } from "../../public/scene-manager/reconnect-coordinator";

/**
 * End-to-end reproduction of the reported failure: an overlay that sits
 * through an outage longer than the 60s session TTL, against a
 * sceneManager that restarts with new code.
 *
 * Driven through a real Bun.serve emitting real SSE bytes, because the
 * bug lived in the interaction between the session cookie's lifetime
 * and the reconnect loop -- not in either piece alone.
 */
function startServer(state: { bootId: string; sessionValid: boolean; down: boolean }) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      if (state.down) {
        return new Response(null, { status: 503 });
      }
      if (!state.sessionValid) {
        return new Response(JSON.stringify({ error: "invalid_session" }), { status: 401 });
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // Byte-for-byte what routes/events.ts writes.
          controller.enqueue(encoder.encode(`event: hello\ndata: ${JSON.stringify({ bootId: state.bootId })}\n\n`));
          // Close immediately rather than holding the stream open: a
          // restart drops the connection, and it is the *reconnect*
          // that has to re-read the boot id. A stream left open never
          // exercises that path at all.
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    },
  });
}

describe("overlay recovery across a sceneManager restart", () => {
  it("reloads when the server comes back with a new boot id", async () => {
    const state = { bootId: "boot-old", sessionValid: true, down: false };
    const server = startServer(state);
    const url = `http://localhost:${server.port}/events`;

    const bootIds: string[] = [];
    let reloads = 0;
    let serverBootId: string | null = null;

    const source = new SceneEventSource({ url, reconnectBaseMs: 2, reconnectMaxMs: 4, coordinator: ALWAYS_PROBE });
    source.start({
      onFrame: () => {},
      onConnectionChange: () => {},
      onHello: (bootId) => {
        bootIds.push(bootId);
        if (serverBootId !== null && serverBootId !== bootId) {
          reloads += 1;
          source.stop();
          return;
        }
        serverBootId = bootId;
      },
    });

    await Bun.sleep(30);
    expect(bootIds).toContain("boot-old");

    // Restart with new code: same session still valid, different boot id.
    state.bootId = "boot-new";
    await Bun.sleep(60);

    expect(reloads).toBe(1);
    source.stop();
    server.stop(true);
  });

  it("reloads when an outage outlives the session TTL and the cookie is rejected", async () => {
    // The reported bug. Before the fix the client retried the same dead
    // cookie forever: 401 was indistinguishable from a network error,
    // no hello frame ever arrived, and the boot-id check never ran --
    // so a restarted server's changes never reached the overlay.
    const state = { bootId: "boot-old", sessionValid: true, down: false };
    const server = startServer(state);
    const url = `http://localhost:${server.port}/events`;

    let sessionExpired = 0;
    let connectedAtLeastOnce = false;

    const source = new SceneEventSource({ url, reconnectBaseMs: 2, reconnectMaxMs: 4, coordinator: ALWAYS_PROBE });
    source.start({
      onFrame: () => {},
      onConnectionChange: (connected) => {
        if (connected) {
          connectedAtLeastOnce = true;
        }
      },
      onHello: () => {},
      onSessionExpired: () => {
        sessionExpired += 1;
        source.stop();
      },
    });

    await Bun.sleep(30);
    expect(connectedAtLeastOnce).toBe(true);

    // Outage longer than the 60s TTL, then a restart. The cookie the
    // client still holds is now expired.
    state.down = true;
    await Bun.sleep(20);
    state.down = false;
    state.sessionValid = false;
    state.bootId = "boot-new";

    await Bun.sleep(60);
    expect(sessionExpired).toBe(1);
    source.stop();
    server.stop(true);
  });

  it("does not reload-loop when the very first connection is rejected", async () => {
    // A page that has never connected must not reload into the same
    // rejection: reloading cannot mint a session the server will accept
    // if it is refusing from the start.
    const state = { bootId: "boot", sessionValid: false, down: false };
    const server = startServer(state);
    const url = `http://localhost:${server.port}/events`;

    let sessionExpired = 0;
    const source = new SceneEventSource({ url, reconnectBaseMs: 2, reconnectMaxMs: 4, coordinator: ALWAYS_PROBE });
    source.start({
      onFrame: () => {},
      onConnectionChange: () => {},
      onSessionExpired: () => {
        sessionExpired += 1;
      },
    });

    await Bun.sleep(50);
    expect(sessionExpired).toBe(0);
    source.stop();
    server.stop(true);
  });
});
