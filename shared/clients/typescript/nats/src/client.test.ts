import { describe, expect, test } from "bun:test";
import { type AddressInfo, createServer } from "node:net";
import { wsconnect } from "@nats-io/nats-core";
import { connectOptions } from "./client";

describe("connectOptions", () => {
  test("sends the configured token", () => {
    const options = connectOptions({ url: "ws://127.0.0.1:4225", name: "test", token: "s3cret" });
    expect(options.token).toBe("s3cret");
  });

  test("sends no token when none is configured", () => {
    expect(connectOptions({ url: "ws://127.0.0.1:4225", name: "test" }).token).toBeUndefined();
    expect(connectOptions({ url: "ws://127.0.0.1:4225", name: "test", token: "  " }).token).toBeUndefined();
  });
});

/** The head of the WebSocket upgrade request wsconnect sends, read off a socket that never upgrades. */
async function upgradeRequest(): Promise<string> {
  let resolveHead: (head: string) => void = () => {};
  const head = new Promise<string>((resolve) => {
    resolveHead = resolve;
  });
  const server = createServer((socket) => {
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString("latin1");
      if (received.includes("\r\n\r\n")) {
        resolveHead(received);
        socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const attempt = wsconnect({ servers: `ws://127.0.0.1:${port}`, reconnect: false, timeout: 2000 }).catch(() => null);
    const request = await head;
    await attempt;
    return request;
  } finally {
    server.close();
  }
}

describe("WebSocket upgrade", () => {
  // The message bus's same-origin check rejects only an upgrade whose Origin
  // names another host, so a client that sends none is unaffected by it.
  test("carries no Origin header under Bun", async () => {
    const request = (await upgradeRequest()).toLowerCase();

    expect(request).toContain("upgrade: websocket");
    expect(request).not.toContain("\r\norigin:");
  });
});
