import { describe, expect, it } from "bun:test";
import { createFrameLoadHandler } from "../../public/scene-manager/widget-bridge";

describe("createFrameLoadHandler", () => {
  it("ignores the first load so it cannot wipe a completed handshake", () => {
    // The shim is a classic script: it sends `hello` during parsing,
    // long before the iframe's first `load`. Resetting on that first
    // fire drops the handshake the widget will never redo, and every
    // later events.subscribe is silently ignored.
    let resets = 0;
    const handler = createFrameLoadHandler({ onFrameLoad: () => { resets += 1; } });
    handler();
    expect(resets).toBe(0);
  });

  it("resets on a subsequent load (in-frame navigation needs a fresh handshake)", () => {
    let resets = 0;
    const handler = createFrameLoadHandler({ onFrameLoad: () => { resets += 1; } });
    handler();
    handler();
    handler();
    expect(resets).toBe(2);
  });

  it("tracks each frame independently", () => {
    let a = 0;
    let b = 0;
    const handlerA = createFrameLoadHandler({ onFrameLoad: () => { a += 1; } });
    const handlerB = createFrameLoadHandler({ onFrameLoad: () => { b += 1; } });
    handlerA();
    handlerA();
    handlerB();
    expect(a).toBe(1);
    expect(b).toBe(0);
  });
});
