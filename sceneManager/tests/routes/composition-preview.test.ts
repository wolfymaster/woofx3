import { describe, expect, it, mock } from "bun:test";
import type { HttpDeps } from "../../src/http";
import {
  handleCompositionPreviewFramesRoute,
  handleCompositionPreviewRefreshRoute,
  handleCompositionPreviewRoute,
  MAX_PREVIEW_WIDGETS,
  PREVIEW_SESSION_COOKIE,
} from "../../src/routes/composition-preview";
import { BODY_LIMITS } from "../../src/routes/http-kit";
import { MediaProxy } from "../../src/scene/media-proxy";
import type { OverlayWidgetInstance } from "../../src/scene/scene-host";
import { SessionTokenService } from "../../src/scene/session-token";

const tokens = new SessionTokenService("test-secret");

function instance(id: string, overrides: Partial<OverlayWidgetInstance> = {}): OverlayWidgetInstance {
  return {
    id,
    widgetCanonicalId: "woofx3:widget:text",
    moduleId: "woofx3",
    manifestId: "text",
    position: { x: 0, y: 0, width: 0, height: 0 },
    settings: {},
    hostsSurface: "",
    frameUrl: "/frames/woofx3/text?v=abc",
    linkedResources: { list: "woofx3:list:1" },
    visible: true,
    resolved: true,
    ...overrides,
  };
}

function deps(framed: OverlayWidgetInstance[] = []) {
  const framePlacements = mock(async (_label: string, _entries: unknown[]) => framed);
  const d = { sessionTokens: tokens, host: { framePlacements }, mediaProxy: new MediaProxy("media-secret") };
  return { deps: d as unknown as HttpDeps, framePlacements };
}

function setCookieOf(response: Response): string {
  return response.headers.get("Set-Cookie") ?? "";
}

function sessionOf(response: Response): string {
  const match = new RegExp(`${PREVIEW_SESSION_COOKIE}=([^;]+)`).exec(setCookieOf(response));
  if (match === null) {
    throw new Error("no preview session cookie was set");
  }
  return match[1];
}

async function openPage(): Promise<string> {
  const token = await tokens.mintPreview();
  const url = new URL(`http://scene.test/preview/composition?token=${token}`);
  return sessionOf(await handleCompositionPreviewRoute(url, deps().deps));
}

function post(path: string, session: string | null, body = ""): Request {
  return new Request(`http://scene.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session === null ? {} : { Cookie: `${PREVIEW_SESSION_COOKIE}=${session}` }),
    },
    body,
  });
}

describe("GET /preview/composition", () => {
  it("serves the page and its session for the api's preview token", async () => {
    const token = await tokens.mintPreview();
    const url = new URL(`http://scene.test/preview/composition?token=${token}`);
    const response = await handleCompositionPreviewRoute(url, deps().deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toContain("/assets/scene-manager/composition-preview-page.js");
    expect(setCookieOf(response)).toContain("HttpOnly");
    expect(setCookieOf(response)).toContain("SameSite=Strict");
    expect(await tokens.verifyPreviewSession(sessionOf(response))).toBe(true);
  });

  it("is a blank page for any other token, an overlay's and an editor's included", async () => {
    const others = [
      "",
      "ovl_abc",
      await tokens.mint({ sceneId: "alert-1", authAt: 0 }),
      await tokens.mintEditor({ sceneId: "alert-1" }),
      await tokens.mintPreviewSession(),
    ];
    for (const token of others) {
      const url = new URL(`http://scene.test/preview/composition?token=${encodeURIComponent(token)}`);
      const response = await handleCompositionPreviewRoute(url, deps().deps);
      expect(response.status).toBe(404);
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(await response.text()).not.toContain("composition-preview-page.js");
    }
  });
});

describe("POST /preview/composition/session/refresh", () => {
  it("renews a live session and refuses anything else", async () => {
    const session = await openPage();
    const renewed = await handleCompositionPreviewRefreshRoute(
      post("/preview/composition/session/refresh", session),
      deps().deps
    );
    expect(renewed.status).toBe(200);
    expect(await tokens.verifyPreviewSession(sessionOf(renewed))).toBe(true);

    for (const cookie of [null, await tokens.mintPreview(), await tokens.mint({ sceneId: "s1", authAt: 0 })]) {
      const refused = await handleCompositionPreviewRefreshRoute(
        post("/preview/composition/session/refresh", cookie),
        deps().deps
      );
      expect(refused.status).toBe(401);
    }
  });
});

describe("POST /preview/composition/frames", () => {
  const body = (widgets: unknown) => JSON.stringify({ widgets });
  // As the dashboard's media picker stores a file hosted elsewhere.
  const picked = { source: "url", name: "a.png", url: "https://cdn.test/a.png", type: "image" };

  it("frames each widget as an overlay would, and says why it cannot frame the rest", async () => {
    const session = await openPage();
    const { deps: d, framePlacements } = deps([
      instance("text", {
        settings: { image: picked },
        mediaProxyBase: "http://bark.test/assets/media/",
        behaviorKinds: { transitions: ["typewriter"], effects: [] },
      }),
      instance("area", { hostsSurface: "alert", widgetCanonicalId: "woofx3:widget:alert" }),
      instance("gone", { resolved: false }),
    ]);
    const widgets = [
      { id: "text", widget: "woofx3:widget:text", settings: { image: picked } },
      { id: "area", widget: "woofx3:widget:alert", settings: {} },
      { id: "gone", widget: "old:widget:thing", settings: {} },
      { id: "bad-id", widget: "nonsense", settings: {} },
    ];
    const response = await handleCompositionPreviewFramesRoute(
      post("/preview/composition/frames", session, body(widgets)),
      d
    );
    expect(response.status).toBe(200);
    const answer = (await response.json()) as {
      widgets: Record<
        string,
        { frameUrl: string; linkedResources: unknown; mediaUrls: Record<string, string>; behaviorKinds: unknown }
      >;
      problems: unknown[];
    };
    expect(Object.keys(answer.widgets)).toEqual(["text"]);
    expect(answer.widgets.text.frameUrl).toBe("/frames/woofx3/text?v=abc");
    expect(answer.widgets.text.linkedResources).toEqual({ list: "woofx3:list:1" });
    expect(answer.widgets.text.behaviorKinds).toEqual({ transitions: ["typewriter"], effects: [] });
    expect(answer.widgets.text.mediaUrls["https://cdn.test/a.png"]).toStartWith("http://bark.test/assets/media/");
    expect(answer.problems).toEqual([
      { kind: "unframed-widget", id: "area" },
      { kind: "unknown-widget", id: "gone" },
      { kind: "unknown-widget", id: "bad-id" },
    ]);
    expect(framePlacements.mock.calls[0]?.[1]).toEqual(
      widgets.map(({ id, widget, settings }) => ({ id, widgetCanonicalId: widget, settings }))
    );
  });

  it("refuses without the preview session, before reading the body", async () => {
    const { deps: d, framePlacements } = deps();
    for (const cookie of [null, await tokens.mint({ sceneId: "s1", authAt: 0 }), await tokens.mintPreview()]) {
      const response = await handleCompositionPreviewFramesRoute(post("/preview/composition/frames", cookie, "[]"), d);
      expect(response.status).toBe(401);
    }
    expect(framePlacements).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a list of widgets", async () => {
    const session = await openPage();
    const { deps: d, framePlacements } = deps();
    const bad = [
      "nope",
      body({}),
      body([{ id: "", widget: "w", settings: {} }]),
      body([{ id: "a", widget: 3, settings: {} }]),
      body([{ id: "a", widget: "w", settings: [] }]),
      body(Array.from({ length: MAX_PREVIEW_WIDGETS + 1 }, (_, i) => ({ id: `w${i}`, widget: "w", settings: {} }))),
    ];
    for (const text of bad) {
      const response = await handleCompositionPreviewFramesRoute(post("/preview/composition/frames", session, text), d);
      expect(response.status).toBe(400);
    }
    const huge = await handleCompositionPreviewFramesRoute(
      post("/preview/composition/frames", session, "x".repeat(BODY_LIMITS.placements + 1)),
      d
    );
    expect(huge.status).toBe(413);
    expect(framePlacements).not.toHaveBeenCalled();
  });
});
