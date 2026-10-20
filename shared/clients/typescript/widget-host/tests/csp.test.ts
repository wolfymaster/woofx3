import { describe, expect, it } from "bun:test";
import { contentSecurityPolicy, withDirectives } from "../frame/csp";
import { FRAME_DIRECTIVES } from "../frame/document";

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
