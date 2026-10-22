import { describe, expect, test } from "bun:test";
import { GetSetting } from "@woofx3/db/setting.pb";
import { dbProxyClientConfig } from "./db-proxy";

describe("dbProxyClientConfig", () => {
  test("aborts a call the server never answers once the timeout passes", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Promise<Response>(() => {}) });
    try {
      const client = dbProxyClientConfig(`http://127.0.0.1:${server.port}`, 50);
      const started = performance.now();
      await expect(GetSetting({ key: "twitch_token" }, client)).rejects.toThrow();
      expect(performance.now() - started).toBeLessThan(2_000);
    } finally {
      server.stop(true);
    }
  });

  const invalid: Array<[name: string, timeoutMs: number]> = [
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
  ];
  for (const [name, timeoutMs] of invalid) {
    test(`refuses a ${name} timeout`, () => {
      expect(() => dbProxyClientConfig("http://127.0.0.1:1", timeoutMs)).toThrow("db-proxy timeout");
    });
  }
});
