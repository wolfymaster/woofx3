import { describe, expect, it } from "bun:test";
import { INERT_DOCUMENT_HEADERS } from "../../src/routes/security-headers";

describe("INERT_DOCUMENT_HEADERS", () => {
  it("sandboxes with nothing allowed and never sniffs", () => {
    expect(INERT_DOCUMENT_HEADERS).toEqual({
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
    });
  });
});
