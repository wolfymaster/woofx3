import { describe, expect, test } from "bun:test";
import { newMessagePortRpcSession, RpcTarget } from "../client";

class Echo extends RpcTarget {
  async echo(text: string): Promise<string> {
    return `echo: ${text}`;
  }

  /** A target returned by reference, which only works when both ends share capnweb's RpcTarget. */
  async counter(): Promise<Counter> {
    return new Counter();
  }
}

class Counter extends RpcTarget {
  private n = 0;

  async next(): Promise<number> {
    this.n += 1;
    return this.n;
  }
}

describe("newMessagePortRpcSession", () => {
  test("serves an RpcTarget from this module over a MessageChannel, targets returned by reference included", async () => {
    const channel = new MessageChannel();
    const server = newMessagePortRpcSession(channel.port1, new Echo());
    const client = newMessagePortRpcSession<Echo>(channel.port2);
    try {
      expect(await client.echo("hi")).toBe("echo: hi");

      using counter = await client.counter();
      expect(await counter.next()).toBe(1);
      expect(await counter.next()).toBe(2);
    } finally {
      client[Symbol.dispose]();
      server[Symbol.dispose]();
      channel.port1.close();
      channel.port2.close();
    }
  });
});
