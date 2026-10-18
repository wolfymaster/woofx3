import { describe, expect, it } from "bun:test";
import { contentSecurityPolicy, INERT_DOCUMENT_HEADERS, withDirectives } from "../../src/routes/security-headers";
import { FRAME_DIRECTIVES } from "../../src/scene/frame-assembler";

describe("contentSecurityPolicy", () => {
  it("writes each directive once, a source-less one bare", () => {
    expect(contentSecurityPolicy({ "img-src": ["'self'", "data:"], sandbox: [] })).toBe(
      "img-src 'self' data:; sandbox"
    );
  });
});

describe("withDirectives", () => {
  it("lets the frame's fixed directives replace whatever a policy says for them", () => {
    const relaxed = { "connect-src": ["*"], "img-src": ["'self'"], sandbox: ["allow-scripts", "allow-same-origin"] };
    const policy = contentSecurityPolicy(withDirectives(relaxed, FRAME_DIRECTIVES));
    expect(policy).toBe("connect-src 'none'; img-src 'self'; sandbox allow-scripts");
  });
});

describe("INERT_DOCUMENT_HEADERS", () => {
  it("sandboxes with nothing allowed and never sniffs", () => {
    expect(INERT_DOCUMENT_HEADERS).toEqual({
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
    });
  });
});
