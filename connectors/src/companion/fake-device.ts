// A websocket device on loopback for the module session tests: it records
// every frame and connection, and answers as each test scripts it. Not
// imported by the host.

import type { Server, ServerWebSocket } from "bun";

/** Answers one inbound text frame; return the frames to send back, in order. */
export type DeviceScript = (frame: string) => Array<string | Uint8Array>;

/** Echoes each frame back, so a request matching its own message resolves. */
export const echo: DeviceScript = (frame) => [frame];

export class FakeDevice {
  readonly frames: string[] = [];
  /** Every connection's request path and query, in the order they arrived. */
  readonly connections: string[] = [];
  script: DeviceScript;
  private readonly sockets = new Set<ServerWebSocket<undefined>>();
  private readonly server: Server<undefined>;

  constructor(script: DeviceScript = echo) {
    this.script = script;
    this.server = Bun.serve<undefined>({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, server) => {
        const url = new URL(request.url);
        this.connections.push(`${url.pathname}${url.search}`);
        return server.upgrade(request, { data: undefined })
          ? undefined
          : new Response("websocket only", { status: 400 });
      },
      websocket: {
        open: (ws) => {
          this.sockets.add(ws);
        },
        close: (ws) => {
          this.sockets.delete(ws);
        },
        message: (ws, message) => {
          const frame = typeof message === "string" ? message : new TextDecoder().decode(message);
          this.frames.push(frame);
          for (const out of this.script(frame)) {
            ws.send(out);
          }
        },
      },
    });
  }

  get port(): number {
    const port = this.server.port;
    if (port === undefined) {
      throw new Error("the fake device has no port");
    }
    return port;
  }

  get open(): number {
    return this.sockets.size;
  }

  /** Sends a frame nobody asked for to every open connection. */
  push(frame: string | Uint8Array): void {
    for (const ws of this.sockets) {
      ws.send(frame);
    }
  }

  /** Closes every connection from the device's side. */
  hangUp(): void {
    for (const ws of this.sockets) {
      ws.close(1001, "device going away");
    }
  }

  /**
   * Stops listening and drops every connection. Not awaited: Bun 1.3's
   * forced stop never settles once the server has closed a websocket itself,
   * as `hangUp` does, and nothing here needs to wait for it.
   */
  stop(): void {
    void this.server.stop(true);
  }
}

/** Waits, in real time, until `check` holds: socket events do not follow the fake clock. */
export async function eventually(check: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await Bun.sleep(5);
  }
}
