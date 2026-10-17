import { describe, expect, test } from "bun:test";
import {
  formatMarketplaceCatalogError,
  type MarketplaceCatalogError,
  parseMarketplaceCatalogError,
} from "../marketplace-catalog";

describe("marketplace catalog errors", () => {
  const cases: MarketplaceCatalogError[] = [
    { kind: "http", status: 404, code: "listing_not_found", message: "listing not found" },
    { kind: "http", status: 400, code: "invalid_request", message: 'unknown sort "x"; expected: a, b\nsecond line' },
    { kind: "timeout", message: "Marketplace GET /catalog timed out after 10000ms" },
    { kind: "unreachable", message: "Marketplace GET /catalog could not be reached: fetch failed" },
    { kind: "disabled", message: "The marketplace is turned off on this engine" },
  ];

  for (const error of cases) {
    test(`round-trips ${error.kind}${error.kind === "http" ? ` ${error.status}` : ""} through an Error message`, () => {
      expect(parseMarketplaceCatalogError(new Error(formatMarketplaceCatalogError(error)))).toEqual(error);
    });
  }

  test("a code that would break the format is written as unknown", () => {
    const message = formatMarketplaceCatalogError({ kind: "http", status: 500, code: "has space", message: "m" });
    expect(parseMarketplaceCatalogError(message)).toEqual({ kind: "http", status: 500, code: "unknown", message: "m" });
  });

  test("anything else is not a marketplace error", () => {
    expect(parseMarketplaceCatalogError(new Error("marketplaceSearch: q must be a string"))).toBeNull();
    expect(parseMarketplaceCatalogError(new Error("'marketplaceSearch' is not a function."))).toBeNull();
    expect(parseMarketplaceCatalogError({ message: "marketplace_timeout: x" })).toBeNull();
    expect(parseMarketplaceCatalogError(undefined)).toBeNull();
  });
});
