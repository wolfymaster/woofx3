import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import { Api } from "../src/api";
import { MarketplaceClient } from "../src/marketplace-client";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function fakeWebhookClient() {
  return {
    send: mock(async (_event: unknown, _clientId?: string) => {}),
    refreshCallbackUrls: mock(async () => {}),
  } as any;
}

const BARKLOADER_URL = "http://barkloader.local";
const DOWNLOAD_URL = "https://marketplace.example.com/download/abc";

const MARKETPLACE_CTX = {
  clientId: "client-a",
  moduleKey: "mod:1.0.0:abcdef1",
  name: "Cool Module",
  version: "1.0.0",
  source: "marketplace" as const,
  marketplaceModuleId: "mp-123",
};

function makeApi(opts: { db: any; webhookClient?: any; marketplace?: MarketplaceClient | null }) {
  const logger = fakeLogger();
  const db = opts.db;
  const api = new Api({
    db,
    nats: null,
    functions: null,
    barkloaderUrl: BARKLOADER_URL,
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger,
    marketplace:
      opts.marketplace === undefined
        ? new MarketplaceClient({
            baseUrl: "https://marketplace.example.com",
            downloadHosts: ["marketplace.example.com"],
          })
        : opts.marketplace,
  });
  if (opts.webhookClient) {
    api.setWebhookClient(opts.webhookClient);
  }
  return { api, logger };
}

function zipResponse(bytes: Uint8Array<ArrayBuffer>, contentLength?: number): Response {
  const headers = new Headers();
  if (contentLength !== undefined) {
    headers.set("content-length", String(contentLength));
  } else {
    headers.set("content-length", String(bytes.byteLength));
  }
  return new Response(bytes, { status: 200, headers });
}

function barkloaderOkResponse(message = "uploaded"): Response {
  return new Response(JSON.stringify({ message }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Api.installModuleFromUrl", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("happy path: fetches archive, posts to barkloader, returns success", async () => {
    const archiveBytes = new Uint8Array(new TextEncoder().encode("PK fake zip bytes"));
    const getModuleByModuleKey = mock(async () => null);
    const db = { getModuleByModuleKey } as any;
    const webhookClient = fakeWebhookClient();
    const { api } = makeApi({ db, webhookClient });

    const fetchCalls: Array<{ url: string; init?: any }> = [];
    globalThis.fetch = mock(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push({ url, init });
      if (url === DOWNLOAD_URL) {
        return zipResponse(archiveBytes);
      }
      if (url.startsWith(BARKLOADER_URL)) {
        return barkloaderOkResponse("uploaded");
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    const result = await api.installModuleFromUrl(DOWNLOAD_URL, MARKETPLACE_CTX.moduleKey, MARKETPLACE_CTX);

    expect(result).toEqual({ success: true, message: "uploaded" });
    expect(getModuleByModuleKey).toHaveBeenCalledWith(MARKETPLACE_CTX.moduleKey);
    expect(fetchCalls.length).toBe(2);
    expect(fetchCalls[0]!.url).toBe(DOWNLOAD_URL);
    expect(fetchCalls[1]!.url).toBe(`${BARKLOADER_URL}/functions`);

    const body = fetchCalls[1]!.init.body as FormData;
    expect(body.get("client_id")).toBe(MARKETPLACE_CTX.clientId);
    expect(body.get("module_key")).toBe(MARKETPLACE_CTX.moduleKey);
    const file = body.get("file") as File;
    expect(file.name).toBe("Cool Module-1.0.0.zip");
    expect(webhookClient.send).not.toHaveBeenCalled();
  });

  it("duplicate short-circuit: skips fetch and emits synthetic webhook", async () => {
    const existingModule = { name: "Existing Module", version: "0.9.0" };
    const getModuleByModuleKey = mock(async () => existingModule);
    const db = { getModuleByModuleKey } as any;
    const webhookClient = fakeWebhookClient();
    const { api } = makeApi({ db, webhookClient });

    const fetchMock = mock(async () => {
      throw new Error("fetch should not be called");
    });
    globalThis.fetch = fetchMock as any;

    const result = await api.installModuleFromUrl(DOWNLOAD_URL, MARKETPLACE_CTX.moduleKey, MARKETPLACE_CTX);

    expect(result).toEqual({
      success: true,
      message: "Module already installed",
      alreadyInstalled: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(webhookClient.send).toHaveBeenCalledTimes(1);
    expect(webhookClient.send).toHaveBeenCalledWith(
      {
        type: "module.installed",
        moduleName: "Existing Module",
        version: "0.9.0",
        moduleKey: MARKETPLACE_CTX.moduleKey,
        alreadyInstalled: true,
      },
      MARKETPLACE_CTX.clientId
    );
  });

  it("marketplace fetch 403: emits install_failed webhook and rethrows", async () => {
    const db = { getModuleByModuleKey: mock(async () => null) } as any;
    const webhookClient = fakeWebhookClient();
    const { api } = makeApi({ db, webhookClient });

    globalThis.fetch = mock(async (input: any) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === DOWNLOAD_URL) {
        return new Response("forbidden", { status: 403, statusText: "Forbidden" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    await expect(api.installModuleFromUrl(DOWNLOAD_URL, MARKETPLACE_CTX.moduleKey, MARKETPLACE_CTX)).rejects.toThrow(
      /Archive download failed: 403/
    );

    expect(webhookClient.send).toHaveBeenCalledTimes(1);
    const [event, clientId] = (webhookClient.send as any).mock.calls[0];
    expect(event.type).toBe("module.install_failed");
    expect(event.moduleKey).toBe(MARKETPLACE_CTX.moduleKey);
    expect(event.moduleName).toBe(MARKETPLACE_CTX.name);
    expect(event.version).toBe(MARKETPLACE_CTX.version);
    expect(event.error).toMatch(/Failed to fetch marketplace archive/);
    expect(clientId).toBe(MARKETPLACE_CTX.clientId);
  });

  it("fetch aborted: emits install_failed and rethrows AbortError", async () => {
    const db = { getModuleByModuleKey: mock(async () => null) } as any;
    const webhookClient = fakeWebhookClient();
    const { api } = makeApi({ db, webhookClient });

    // Simulate the AbortController timeout firing by rejecting with AbortError
    // as soon as the signal aborts. We aren't waiting the full 30s — we trip
    // the signal ourselves immediately to keep the test fast.
    globalThis.fetch = mock((_input: any, init?: any) => {
      const signal: AbortSignal | undefined = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          const err = new Error("The operation was aborted.");
          (err as any).name = "AbortError";
          reject(err);
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        // Trip the abort immediately so the test does not wait for the
        // real 30s production timeout.
        queueMicrotask(() => {
          // Mirror what setTimeout(controller.abort, ...) would do, but
          // without waiting. The signal abort comes from the production
          // AbortController; we can't reach it directly, so we throw an
          // AbortError directly here instead.
          if (!signal?.aborted) {
            onAbort();
          }
        });
      });
    }) as any;

    await expect(api.installModuleFromUrl(DOWNLOAD_URL, MARKETPLACE_CTX.moduleKey, MARKETPLACE_CTX)).rejects.toThrow();

    expect(webhookClient.send).toHaveBeenCalledTimes(1);
    const [event] = (webhookClient.send as any).mock.calls[0];
    expect(event.type).toBe("module.install_failed");
    expect(event.moduleKey).toBe(MARKETPLACE_CTX.moduleKey);
  });

  it("size cap via Content-Length header: throws before reading body", async () => {
    const db = { getModuleByModuleKey: mock(async () => null) } as any;
    const webhookClient = fakeWebhookClient();
    const { api } = makeApi({ db, webhookClient });

    const oversized = 51 * 1024 * 1024;
    let bodyRead = false;
    globalThis.fetch = mock(async () => {
      const headers = new Headers({ "content-length": String(oversized) });
      // Wrap an empty body in a Response whose .arrayBuffer() flips the flag
      // if it ever gets called. The header check should short-circuit before
      // that happens.
      const res = new Response(new ArrayBuffer(0), { status: 200, headers });
      const original = res.arrayBuffer.bind(res);
      res.arrayBuffer = async () => {
        bodyRead = true;
        return original();
      };
      return res;
    }) as any;

    await expect(api.installModuleFromUrl(DOWNLOAD_URL, MARKETPLACE_CTX.moduleKey, MARKETPLACE_CTX)).rejects.toThrow(
      /exceeds size cap/
    );

    expect(bodyRead).toBe(false);
    expect(webhookClient.send).toHaveBeenCalledTimes(1);
    expect((webhookClient.send as any).mock.calls[0][0].type).toBe("module.install_failed");
  });

  it("size cap on the streamed body: cuts off a body larger than its content-length says", async () => {
    const db = { getModuleByModuleKey: mock(async () => null) } as any;
    const webhookClient = fakeWebhookClient();
    const { api } = makeApi({ db, webhookClient });

    const oversized = 51 * 1024 * 1024;
    globalThis.fetch = mock(async () => {
      const buf = new ArrayBuffer(oversized);
      const headers = new Headers({ "content-length": "0" });
      return new Response(buf, { status: 200, headers });
    }) as any;

    await expect(api.installModuleFromUrl(DOWNLOAD_URL, MARKETPLACE_CTX.moduleKey, MARKETPLACE_CTX)).rejects.toThrow(
      /exceeds size cap/
    );

    expect(webhookClient.send).toHaveBeenCalledTimes(1);
  });

  it("missing moduleKey: throws synchronously", async () => {
    const db = { getModuleByModuleKey: mock(async () => null) } as any;
    const { api } = makeApi({ db });

    await expect(api.installModuleFromUrl(DOWNLOAD_URL, "", { ...MARKETPLACE_CTX, moduleKey: "" })).rejects.toThrow(
      /moduleKey is required/
    );
  });

  it("missing clientId: throws synchronously", async () => {
    const db = { getModuleByModuleKey: mock(async () => null) } as any;
    const { api } = makeApi({ db });

    await expect(
      api.installModuleFromUrl(DOWNLOAD_URL, MARKETPLACE_CTX.moduleKey, {
        ...MARKETPLACE_CTX,
        clientId: "",
      })
    ).rejects.toThrow(/clientId is required/);
  });

  it("refuses a file: URL without fetching it", async () => {
    const db = { getModuleByModuleKey: mock(async () => null) } as any;
    const webhookClient = fakeWebhookClient();
    const { api } = makeApi({ db, webhookClient });
    const fetchMock = mock(async () => new Response("should not be fetched"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      api.installModuleFromUrl("file:///etc/hostname", MARKETPLACE_CTX.moduleKey, MARKETPLACE_CTX)
    ).rejects.toThrow(/scheme file: is not allowed/);

    expect(fetchMock).not.toHaveBeenCalled();
    expect((webhookClient.send as any).mock.calls[0][0].type).toBe("module.install_failed");
  });

  it("refuses a host outside the download allow-list without fetching it", async () => {
    const db = { getModuleByModuleKey: mock(async () => null) } as any;
    const { api } = makeApi({ db, webhookClient: fakeWebhookClient() });
    const fetchMock = mock(async () => new Response("should not be fetched"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      api.installModuleFromUrl("http://127.0.0.1:5555/v1/modules", MARKETPLACE_CTX.moduleKey, MARKETPLACE_CTX)
    ).rejects.toThrow(/is not an allowed download host/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an archive that does not match the given sha256, before barkloader sees it", async () => {
    const db = { getModuleByModuleKey: mock(async () => null) } as any;
    const { api } = makeApi({ db, webhookClient: fakeWebhookClient() });
    const fetchCalls: string[] = [];
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      fetchCalls.push(url);
      return zipResponse(new Uint8Array(new TextEncoder().encode("PK tampered")));
    }) as unknown as typeof fetch;
    const expected = createHash("sha256").update("PK original").digest("hex");

    await expect(
      api.installModuleFromUrl(DOWNLOAD_URL, MARKETPLACE_CTX.moduleKey, { ...MARKETPLACE_CTX, sha256: expected })
    ).rejects.toThrow(/does not match its expected sha256/);

    expect(fetchCalls).toEqual([DOWNLOAD_URL]);
  });

  it("installs an archive that matches the given sha256, accepting it in upper case", async () => {
    const archiveBytes = new Uint8Array(new TextEncoder().encode("PK original"));
    const db = { getModuleByModuleKey: mock(async () => null) } as any;
    const { api } = makeApi({ db, webhookClient: fakeWebhookClient() });
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      return url === DOWNLOAD_URL ? zipResponse(archiveBytes) : barkloaderOkResponse("uploaded");
    }) as unknown as typeof fetch;
    const expected = createHash("sha256").update(archiveBytes).digest("hex").toUpperCase();

    const result = await api.installModuleFromUrl(DOWNLOAD_URL, MARKETPLACE_CTX.moduleKey, {
      ...MARKETPLACE_CTX,
      sha256: expected,
    });

    expect(result).toEqual({ success: true, message: "uploaded" });
  });

  it("refuses a malformed sha256 before fetching anything", async () => {
    const db = { getModuleByModuleKey: mock(async () => null) } as any;
    const { api } = makeApi({ db });
    const fetchMock = mock(async () => new Response("should not be fetched"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      api.installModuleFromUrl(DOWNLOAD_URL, MARKETPLACE_CTX.moduleKey, { ...MARKETPLACE_CTX, sha256: "abc" })
    ).rejects.toThrow(/sha256 must be 64 hex characters/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to run with marketplace installs turned off", async () => {
    const getModuleByModuleKey = mock(async () => null);
    const { api } = makeApi({ db: { getModuleByModuleKey } as any, marketplace: null });
    const fetchMock = mock(async () => new Response("should not be fetched"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.installModuleFromUrl(DOWNLOAD_URL, MARKETPLACE_CTX.moduleKey, MARKETPLACE_CTX)).rejects.toThrow(
      /turned off/
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getModuleByModuleKey).not.toHaveBeenCalled();
  });
});
