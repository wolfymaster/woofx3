import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SharedLogger } from "@woofx3/common/logging";
import { hasBarkloaderBearer, parseBarkloaderWebhookAuth } from "../src/barkloader-webhook-auth";
import type { ApiGateway } from "../src/gateway";
import { createHttpServer } from "../src/http";

const SECRET = "engine-secret";
const PATH = "/webhooks/barkloader/processing";

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as SharedLogger;

let server: ReturnType<typeof createHttpServer> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

function start(barkloaderWebhookSecret: string | null) {
  const onProcessingCallback = mock(async (_body: unknown) => {});
  server = createHttpServer({
    port: 0,
    hostname: "127.0.0.1",
    readiness: async () => ({ ready: true }) as never,
    health: () => ({ status: "ok" }) as never,
    logger: silentLogger,
    gateway: {} as ApiGateway,
    onProcessingCallback,
    barkloaderWebhookSecret,
  });
  const post = (headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${server!.port}${PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ resource_id: "res-1", status: "completed" }),
    });
  return { post, onProcessingCallback };
}

describe("parseBarkloaderWebhookAuth", () => {
  test("is off unless set to required", () => {
    expect(parseBarkloaderWebhookAuth(undefined)).toBe("off");
    expect(parseBarkloaderWebhookAuth(" ")).toBe("off");
    expect(parseBarkloaderWebhookAuth("off")).toBe("off");
    expect(parseBarkloaderWebhookAuth("Required")).toBe("required");
  });

  test("refuses anything else", () => {
    expect(() => parseBarkloaderWebhookAuth("true")).toThrow("WOOFX3_BARKLOADER_WEBHOOK_AUTH");
  });
});

describe("hasBarkloaderBearer", () => {
  const withAuth = (value?: string) =>
    new Request("http://api.test/", value === undefined ? {} : { headers: { authorization: value } });

  test("accepts the secret as a bearer token", () => {
    expect(hasBarkloaderBearer(withAuth(`Bearer ${SECRET}`), SECRET)).toBe(true);
    expect(hasBarkloaderBearer(withAuth(`bearer ${SECRET}`), SECRET)).toBe(true);
  });

  test("refuses a missing, wrong or differently-schemed token", () => {
    for (const value of [undefined, "", "Bearer", "Bearer nope", `Bearer ${SECRET}x`, `Basic ${SECRET}`, SECRET]) {
      expect(hasBarkloaderBearer(withAuth(value), SECRET)).toBe(false);
    }
  });
});

describe("processing callback with auth off", () => {
  test("is accepted without a token, as it always has been", async () => {
    const { post, onProcessingCallback } = start(null);

    const res = await post();

    expect(res.status).toBe(204);
    expect(onProcessingCallback).toHaveBeenCalledTimes(1);
  });

  test("is accepted with a token from an updated barkloader", async () => {
    const { post, onProcessingCallback } = start(null);

    expect((await post({ authorization: "Bearer whatever" })).status).toBe(204);
    expect(onProcessingCallback).toHaveBeenCalledTimes(1);
  });
});

describe("processing callback with auth required", () => {
  test("is refused without the token, and not recorded", async () => {
    const { post, onProcessingCallback } = start(SECRET);

    const res = await post();

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(onProcessingCallback).not.toHaveBeenCalled();
  });

  test("is refused with the wrong token", async () => {
    const { post, onProcessingCallback } = start(SECRET);

    expect((await post({ authorization: "Bearer nope" })).status).toBe(401);
    expect(onProcessingCallback).not.toHaveBeenCalled();
  });

  test("is recorded with the token", async () => {
    const { post, onProcessingCallback } = start(SECRET);

    expect((await post({ authorization: `Bearer ${SECRET}` })).status).toBe(204);
    expect(onProcessingCallback).toHaveBeenCalledWith({ resource_id: "res-1", status: "completed" });
  });
});
