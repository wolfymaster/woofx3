import { describe, expect, test } from "bun:test";
import BarkloaderClient from "./index";

const OPEN = 1;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = OPEN;
  readyState = OPEN;
  sent: string[] = [];
  private listeners: Record<string, ((e: unknown) => void)[]> = {};

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }

  removeEventListener() {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {}

  // Test helper: simulate the server replying to the most recent invoke.
  emitMessage(data: unknown) {
    for (const cb of this.listeners.message ?? []) {
      cb({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

function makeClient() {
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  const client = new BarkloaderClient({
    wsUrl: "ws://localhost:9999/ws",
    onOpen: () => {},
    onClose: () => {},
    onError: () => {},
  });
  client.connect();
  const socket = FakeWebSocket.instances.at(-1)!;
  return { client, socket };
}

describe("BarkloaderClient.invoke", () => {
  test("sends the modern {function, event} wire shape, not the legacy func/args shape", async () => {
    const { client, socket } = makeClient();

    const pending = client.invoke("spotify:function:song_request", {
      data: { command: "sr", text: "bad angel", variables: { songTitle: "bad angel" } },
    });

    expect(socket.sent.length).toBe(1);
    const sent = JSON.parse(socket.sent[0]!);
    expect(sent.type).toBe("invoke");
    expect(sent.data.function).toBe("spotify:function:song_request");
    expect(sent.data.event).toEqual({
      data: { command: "sr", text: "bad angel", variables: { songTitle: "bad angel" } },
    });
    // The legacy fields must not be sent by this client anymore.
    expect(sent.data.func).toBeUndefined();
    expect(sent.data.args).toBeUndefined();

    socket.emitMessage({ type: "result", id: sent.id, data: { result: { sent: true } } });
    expect(await pending).toEqual({ sent: true });
  });
});
