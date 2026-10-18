import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { type MarketplaceCatalogError, parseMarketplaceCatalogError } from "@woofx3/api";
import { MarketplaceClient } from "../src/marketplace-client";
import { marketplaceCatalogRoutes } from "../src/routes/marketplace-catalog";

// ---------- a fake marketplace ----------

interface Seen {
  method: string;
  path: string;
  search: string;
  authorization: string | null;
}

const seen: Seen[] = [];

/** What the fake answers; each test sets it. */
let respond: (url: URL) => Response | Promise<Response> = () => new Response("unset", { status: 500 });

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req): Promise<Response> {
    const url = new URL(req.url);
    seen.push({
      method: req.method,
      path: url.pathname,
      search: url.search,
      authorization: req.headers.get("authorization"),
    });
    return await respond(url);
  },
});

const BASE = `http://127.0.0.1:${server.port}`;

afterAll(() => {
  server.stop(true);
});

beforeEach(() => {
  seen.length = 0;
  respond = () => new Response("unset", { status: 500 });
});

/** Serves `text` verbatim as JSON, so a test can compare what the engine returns with the exact bytes sent. */
function jsonText(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "Content-Type": "application/json" } });
}

function errorEnvelope(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

// ---------- a route host ----------

function host(marketplace: MarketplaceClient | null = new MarketplaceClient({ baseUrl: BASE, downloadHosts: [BASE] })) {
  return { marketplace, logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } };
}

type Route = (...args: unknown[]) => Promise<unknown>;

function call(name: keyof typeof marketplaceCatalogRoutes, self: object, ...args: unknown[]): Promise<unknown> {
  return (marketplaceCatalogRoutes[name] as unknown as Route).call(self, ...args);
}

/** The catalog error a call rejected with, failing the test when it resolved or threw something else. */
async function catalogError(promise: Promise<unknown>): Promise<MarketplaceCatalogError> {
  let thrown: unknown;
  try {
    await promise;
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(Error);
  const parsed = parseMarketplaceCatalogError(thrown);
  if (parsed === null) {
    throw new Error(`not a marketplace catalog error: ${(thrown as Error).message}`);
  }
  return parsed;
}

// ---------- tests ----------

describe("pass-through fidelity", () => {
  // Keys the engine knows nothing about, nulls, nested arrays, unicode and
  // numbers in several forms: everything must come back as the marketplace
  // sent it.
  const body = JSON.stringify({
    listings: [
      {
        id: "cozy-cats",
        type: "overlay",
        name: "Cozy Cats é\u{1F431}",
        pricing: null,
        rating: null,
        ratingCount: 0,
        credits: [{ role: "art", name: "A" }],
        futureField: { nested: [1, 2.5, -3e-7, true, null, ""] },
      },
    ],
    total: 1,
    limit: 24,
    offset: 0,
  });

  test("marketplaceSearch returns the marketplace's JSON unchanged", async () => {
    respond = () => jsonText(body);
    const result = await call("marketplaceSearch", host(), {});
    expect(JSON.stringify(result)).toBe(body);
    expect(seen).toEqual([{ method: "GET", path: "/catalog", search: "", authorization: null }]);
  });

  test("marketplaceCounts, marketplaceGetListing, marketplaceGetAuthor and marketplaceQuote do too", async () => {
    const answers: Record<string, string> = {
      "/catalog/counts": JSON.stringify({ counts: { module: 3, theme: 0, emote: 1, overlay: 2, alert: 0 }, total: 6 }),
      "/catalog/cozy-cats": JSON.stringify({ listing: { id: "cozy-cats", previews: [], module: null, x: { y: 1 } } }),
      "/authors/wolfy": JSON.stringify({
        author: { slug: "wolfy", displayName: "Wolfy", links: [], claimed: true },
        listings: [],
        total: 0,
        limit: 24,
        offset: 0,
      }),
      "/catalog/cozy-cats/quote": JSON.stringify({ quote: { kind: "upgrade", amountCents: 250, upgradeFrom: "a" } }),
    };
    respond = (url) => jsonText(answers[url.pathname] ?? "{}");
    const h = host();
    expect(JSON.stringify(await call("marketplaceCounts", h))).toBe(answers["/catalog/counts"]);
    expect(JSON.stringify(await call("marketplaceGetListing", h, "cozy-cats"))).toBe(answers["/catalog/cozy-cats"]);
    expect(JSON.stringify(await call("marketplaceGetAuthor", h, "wolfy"))).toBe(answers["/authors/wolfy"]);
    expect(JSON.stringify(await call("marketplaceQuote", h, "cozy-cats", "tok"))).toBe(
      answers["/catalog/cozy-cats/quote"]
    );
  });

  test("path segments are encoded, so an id cannot reach another route", async () => {
    respond = () => jsonText("{}");
    await call("marketplaceGetListing", host(), "a/../quote");
    await call("marketplaceGetAuthor", host(), "x?limit=1");
    expect(seen.map((s) => `${s.path}${s.search}`)).toEqual(["/catalog/a%2F..%2Fquote", "/authors/x%3Flimit%3D1"]);
  });
});

describe("query parameters", () => {
  test("marketplaceSearch sends every known parameter under the marketplace's names", async () => {
    respond = () => jsonText("{}");
    await call("marketplaceSearch", host(), {
      q: "cozy cats",
      type: ["overlay", "alert"],
      category: "fun",
      author: "wolfy",
      featured: true,
      sort: "trending",
      limit: 24,
      offset: 48,
    });
    expect(seen[0].search).toBe(
      "?q=cozy+cats&type=overlay%2Calert&category=fun&author=wolfy&featured=true&sort=trending&limit=24&offset=48"
    );
  });

  test("leaves out empty values, an empty type list and featured=false", async () => {
    respond = () => jsonText("{}");
    await call("marketplaceSearch", host(), { q: "", type: [], category: undefined, featured: false });
    expect(seen[0].search).toBe("");
  });

  test("refuses an unknown key without calling the marketplace", async () => {
    respond = () => jsonText("{}");
    await expect(call("marketplaceSearch", host(), { q: "x", buyerRef: "account:someone" })).rejects.toThrow(
      'unknown query parameter "buyerRef"'
    );
    await expect(call("marketplaceGetAuthor", host(), "wolfy", { limit: 1, sort: "name" })).rejects.toThrow(
      'unknown query parameter "sort"'
    );
    expect(seen).toEqual([]);
  });

  test("refuses values of the wrong shape without calling the marketplace", async () => {
    respond = () => jsonText("{}");
    const h = host();
    await expect(call("marketplaceSearch", h, "q=x")).rejects.toThrow("query must be an object");
    await expect(call("marketplaceSearch", h, { q: 1 })).rejects.toThrow("q must be a string");
    await expect(call("marketplaceSearch", h, { type: "module" })).rejects.toThrow("type must be an array");
    await expect(call("marketplaceSearch", h, { featured: "true" })).rejects.toThrow("featured must be a boolean");
    await expect(call("marketplaceSearch", h, { limit: 1.5 })).rejects.toThrow("limit must be an integer");
    await expect(call("marketplaceGetAuthor", h, "wolfy", { offset: "2" })).rejects.toThrow(
      "offset must be an integer"
    );
    await expect(call("marketplaceGetListing", h, "")).rejects.toThrow("listingId is required");
    await expect(call("marketplaceGetAuthor", h, "")).rejects.toThrow("slug is required");
    expect(seen).toEqual([]);
  });

  test("forwards a type or sort the engine does not know, for the marketplace to judge", async () => {
    respond = (url) =>
      url.searchParams.get("sort") === "loudest"
        ? errorEnvelope(400, "invalid_request", 'unknown sort "loudest"')
        : jsonText(JSON.stringify({ listings: [], total: 0 }));
    expect(await call("marketplaceSearch", host(), { type: ["sticker"] })).toEqual({ listings: [], total: 0 });
    expect(await catalogError(call("marketplaceSearch", host(), { sort: "loudest" }))).toEqual({
      kind: "http",
      status: 400,
      code: "invalid_request",
      message: 'unknown sort "loudest"',
    });
  });

  test("marketplaceGetAuthor sends its page", async () => {
    respond = () => jsonText("{}");
    await call("marketplaceGetAuthor", host(), "wolfy", { limit: 12, offset: 12 });
    expect(seen[0].search).toBe("?limit=12&offset=12");
  });
});

describe("buyer tokens", () => {
  test("are forwarded as the bearer on every read when given", async () => {
    respond = () => jsonText("{}");
    const h = host();
    await call("marketplaceSearch", h, { q: "x" }, "tok-1");
    await call("marketplaceCounts", h, "tok-2");
    await call("marketplaceGetListing", h, "cozy-cats", "tok-3");
    await call("marketplaceGetAuthor", h, "wolfy", undefined, "tok-4");
    await call("marketplaceQuote", h, "cozy-cats", "tok-5");
    expect(seen.map((s) => s.authorization)).toEqual([
      "Bearer tok-1",
      "Bearer tok-2",
      "Bearer tok-3",
      "Bearer tok-4",
      "Bearer tok-5",
    ]);
  });

  test("an absent or empty token sends no Authorization header", async () => {
    respond = () => jsonText("{}");
    const h = host();
    await call("marketplaceSearch", h, {});
    await call("marketplaceCounts", h, "");
    await call("marketplaceGetListing", h, "cozy-cats", undefined);
    await call("marketplaceGetAuthor", h, "wolfy");
    expect(seen.map((s) => s.authorization)).toEqual([null, null, null, null]);
  });

  test("a quote needs a token, and never sends a buyerRef", async () => {
    respond = () => jsonText(JSON.stringify({ quote: { kind: "free" } }));
    await expect(call("marketplaceQuote", host(), "cozy-cats")).rejects.toThrow("buyerToken is required");
    expect(seen).toEqual([]);
    await call("marketplaceQuote", host(), "cozy-cats", "tok");
    expect(seen).toEqual([
      { method: "GET", path: "/catalog/cozy-cats/quote", search: "", authorization: "Bearer tok" },
    ]);
  });

  test("a token that is not a string is refused", async () => {
    await expect(call("marketplaceCounts", host(), 42)).rejects.toThrow("buyerToken must be a string");
  });
});

describe("errors", () => {
  test("a marketplace error envelope keeps its status, code and message", async () => {
    respond = () => errorEnvelope(404, "listing_not_found", "listing not found");
    expect(await catalogError(call("marketplaceGetListing", host(), "gone"))).toEqual({
      kind: "http",
      status: 404,
      code: "listing_not_found",
      message: "listing not found",
    });
  });

  test("a refused token keeps the marketplace's 401", async () => {
    respond = () => errorEnvelope(401, "unauthorized", "invalid credential");
    expect(await catalogError(call("marketplaceSearch", host(), {}, "expired"))).toMatchObject({
      kind: "http",
      status: 401,
      code: "unauthorized",
    });
  });

  test("a body that is not the envelope is code unknown", async () => {
    respond = () => new Response("<html>bad gateway</html>", { status: 502 });
    const error = await catalogError(call("marketplaceCounts", host()));
    expect(error).toMatchObject({ kind: "http", status: 502, code: "unknown" });
    expect(error.message).toContain("failed with 502");
  });

  test("a 2xx body that is not JSON is an engine error, not a marketplace one", async () => {
    respond = () => new Response("not json", { status: 200 });
    await expect(call("marketplaceCounts", host())).rejects.toThrow("is not JSON");
  });

  test("a marketplace that does not answer in time is a timeout", async () => {
    respond = async () => {
      await Bun.sleep(300);
      return jsonText("{}");
    };
    const marketplace = new MarketplaceClient({ baseUrl: BASE, downloadHosts: [BASE], requestTimeoutMs: 50 });
    const error = await catalogError(call("marketplaceSearch", host(marketplace), {}));
    expect(error.kind).toBe("timeout");
    expect(error.message).toContain("timed out after 50ms");
  });

  test("a marketplace that cannot be reached is unreachable", async () => {
    const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
    const url = `http://127.0.0.1:${closed.port}`;
    closed.stop(true);
    const marketplace = new MarketplaceClient({ baseUrl: url, downloadHosts: [url] });
    expect((await catalogError(call("marketplaceCounts", host(marketplace)))).kind).toBe("unreachable");
  });

  test("every read says the marketplace is disabled when marketplaceUrl is blank", async () => {
    const h = host(null);
    const calls: Array<Promise<unknown>> = [
      call("marketplaceSearch", h, {}),
      call("marketplaceCounts", h),
      call("marketplaceGetListing", h, "cozy-cats"),
      call("marketplaceGetAuthor", h, "wolfy"),
      call("marketplaceQuote", h, "cozy-cats", "tok"),
    ];
    for (const pending of calls) {
      const error = await catalogError(pending);
      expect(error.kind).toBe("disabled");
      expect(error.message).toContain("marketplaceUrl is blank");
    }
    expect(seen).toEqual([]);
  });
});
