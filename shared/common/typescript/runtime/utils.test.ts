import { expect, test } from "bun:test";
import { buildHeartbeat } from "./heartbeat";
import type { Service } from "./service";
import { createNATSHealthCheck } from "./utils";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test("a dependency is ready only once a valid ready heartbeat names it", async () => {
  let deliver: (data: Uint8Array) => void = () => {};
  const natsClient = {
    publish: () => {},
    subscribe: async (_subject: string, handler: (msg: { data: Uint8Array }) => void) => {
      deliver = (data) => handler({ data });
      return { unsubscribe: () => {} };
    },
  } as never;
  const barkloader = { name: "barkloader", healthcheck: true } as Service<unknown>;
  const check = createNATSHealthCheck(natsClient);

  expect(await check({ barkloader })).toBe(false);

  deliver(encode({ ping: true }));
  expect(await check({ barkloader })).toBe(false);

  deliver(encode(buildHeartbeat("barkloader", false, new Date())));
  expect(await check({ barkloader })).toBe(false);

  deliver(encode(buildHeartbeat("barkloader", true, new Date())));
  expect(await check({ barkloader })).toBe(true);
});
