import { describe, expect, test } from "bun:test";
import { GetSetting } from "@woofx3/db/setting.pb";
import DbProxyService, { dbProxyClientConfig } from "./db-proxy";

const TOKEN = "connectors-db-proxy-token-0123456789abcdef";

describe("dbProxyClientConfig", () => {
  test("sends the service token on every call", async () => {
    let authorization = "";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        authorization = request.headers.get("authorization") ?? "";
        return new Response("{}", { headers: { "content-type": "application/json" } });
      },
    });
    try {
      // Only the request matters here; the answer is not a valid setting and fails to decode.
      await GetSetting(
        { key: "twitch_token" },
        dbProxyClientConfig(`http://127.0.0.1:${server.port}`, TOKEN, 1_000)
      ).catch(() => undefined);
      expect(authorization).toBe(`Bearer ${TOKEN}`);
    } finally {
      server.stop(true);
    }
  });

  test("aborts a call the server never answers once the timeout passes", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Promise<Response>(() => {}) });
    try {
      const client = dbProxyClientConfig(`http://127.0.0.1:${server.port}`, TOKEN, 50);
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
      expect(() => dbProxyClientConfig("http://127.0.0.1:1", TOKEN, timeoutMs)).toThrow("db-proxy timeout");
    });
  }
});

describe("DbProxyService.healthcheck", () => {
  const FAILURES = 3;

  async function withServer(fetch: () => Response | Promise<Response>, run: (url: string) => Promise<void>) {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
    try {
      await run(`http://127.0.0.1:${server.port}`);
    } finally {
      server.stop(true);
    }
  }

  const pong = () => new Response(new Uint8Array(), { headers: { "content-type": "application/protobuf" } });
  const refuse = () => Response.json({ code: "unavailable", msg: "db down" }, { status: 503 });

  test("is healthy while db-proxy answers the ping", async () => {
    await withServer(pong, async (url) => {
      expect(await new DbProxyService(url, TOKEN, 1_000, FAILURES).healthcheck()).toBe(true);
    });
  });

  test("stays healthy through fewer failed pings in a row than the limit, and fails at the limit", async () => {
    await withServer(refuse, async (url) => {
      const service = new DbProxyService(url, TOKEN, 1_000, FAILURES);
      for (let ping = 1; ping < FAILURES; ping++) {
        expect(await service.healthcheck()).toBe(true);
      }
      expect(await service.healthcheck()).toBe(false);
    });
  });

  test("a ping that succeeds resets the failure count", async () => {
    let up = false;
    await withServer(
      () => (up ? pong() : refuse()),
      async (url) => {
        const service = new DbProxyService(url, TOKEN, 1_000, FAILURES);
        for (let ping = 1; ping < FAILURES; ping++) {
          expect(await service.healthcheck()).toBe(true);
        }
        up = true;
        expect(await service.healthcheck()).toBe(true);
        up = false;
        for (let ping = 1; ping < FAILURES; ping++) {
          expect(await service.healthcheck()).toBe(true);
        }
        expect(await service.healthcheck()).toBe(false);
      }
    );
  });

  test("a ping db-proxy never answers times out and counts as failed", async () => {
    await withServer(
      () => new Promise<Response>(() => {}),
      async (url) => {
        const started = performance.now();
        expect(await new DbProxyService(url, TOKEN, 50, 1).healthcheck()).toBe(false);
        expect(performance.now() - started).toBeLessThan(2_000);
      }
    );
  });

  for (const [name, failures] of [
    ["zero", 0],
    ["fractional", 1.5],
  ] as const) {
    test(`refuses a ${name} failure count`, () => {
      expect(() => new DbProxyService("http://127.0.0.1:1", TOKEN, 1_000, failures)).toThrow(
        "db-proxy health failure count"
      );
    });
  }
});
