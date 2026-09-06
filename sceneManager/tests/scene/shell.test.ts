import { describe, expect, it } from "bun:test";
import { renderSceneShell } from "../../src/scene/shell";

const scene = { id: "scene-1", applicationId: "app-1", name: "Demo", layout: {}, widgets: [] };

describe("renderSceneShell", () => {
  it("renders without throwing and embeds the scene config", () => {
    // Not as trivial as it looks: the shell is one big template
    // literal, so a stray backtick or `${` in the CSS/markup turns into
    // a substitution and either throws here or silently mangles the
    // document. Nothing else in the pipeline would catch that.
    const html = renderSceneShell({ scene });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('window.__WOOFX3_SCENE__ = {"scene":{"id":"scene-1"');
  });

  it("renders the connection badge structure the client script drives", () => {
    // index.ts toggles `.visible` on #disconnected-banner and nothing
    // else -- these ids are the whole contract between shell and client.
    const html = renderSceneShell({ scene });
    for (const id of ["disconnected-banner", "disconnected-pill", "disconnected-icon", "disconnected-text"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("woofx3 overlay disconnected");
  });

  it("keeps the badge out of the way of the scene", () => {
    const html = renderSceneShell({ scene });
    // A purely informational badge must never swallow clicks, and it
    // must sit in the corner rather than scrim the whole scene -- this
    // overlay is composited into a live stream.
    expect(html).toContain("pointer-events: none");
    expect(html).not.toContain("inset: 0");
  });

  it("drives the badge from CSS alone on the 16s cycle", () => {
    // 16s = 5s expanded + 0.5s collapse + 10s collapsed + 0.5s expand.
    // Both animations must share the duration or the spin and the
    // reveal drift out of phase with each other.
    const html = renderSceneShell({ scene });
    expect(html).toContain("animation: dc-spin 16s ease-in-out infinite");
    expect(html).toContain("animation: dc-reveal 16s ease-in-out infinite");
    expect(html).toContain("@keyframes dc-spin");
    expect(html).toContain("@keyframes dc-reveal");
  });

  it("starts the cycle expanded so a fresh disconnect reads immediately", () => {
    // The animation restarts whenever the badge becomes visible. If 0%
    // were the collapsed state, a new disconnect would sit as a bare
    // square for 10 seconds before ever saying what was wrong.
    const html = renderSceneShell({ scene });
    expect(html).toContain("0%, 31.25%       { max-width: 260px; padding-right: 12px; opacity: 1; }");
    expect(html).toContain("34.375%, 96.875% { max-width: 0;     padding-right: 0;    opacity: 0; }");
  });

  it("escapes markup in the embedded scene config", () => {
    const hostile = { ...scene, name: "</script><script>alert(1)</script>" };
    const html = renderSceneShell({ scene: hostile });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });
});
