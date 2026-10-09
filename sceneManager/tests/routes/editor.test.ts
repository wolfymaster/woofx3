import { afterEach, describe, expect, it } from "bun:test";
import {
  type EditorSocketData,
  editorSocketHandlers,
  failedMessageError,
  handleEditorUpgrade,
} from "../../src/routes/editor";
import { SceneDocuments } from "../../src/scene/scene-documents";
import type { OverlaySceneState } from "../../src/scene/scene-host";
import { SessionTokenService } from "../../src/scene/session-token";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as never;

const SCENE: OverlaySceneState = {
  sceneId: "s1",
  name: "Main",
  layout: {},
  instances: [
    {
      id: "a",
      widgetCanonicalId: "woofx3:widget:text",
      moduleId: "woofx3",
      manifestId: "text",
      position: { x: 0, y: 0, width: 100, height: 50 },
      settings: { text: "hi" },
      visible: true,
      hostsSurface: "",
      frameUrl: "/frames/woofx3/text?v=1",
      linkedResources: {},
      resolved: true,
    },
  ],
};

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

function start() {
  const sessionTokens = new SessionTokenService("test-secret");
  const sceneDocuments = new SceneDocuments(
    {
      loadFramedSceneById: async (sceneId) => (sceneId === "s1" ? SCENE : null),
      framePlacements: async () => [],
    },
    { broadcast: () => {}, connectedSceneIds: () => [] },
    logger
  );
  const deps = { sessionTokens, sceneDocuments, logger };
  server = Bun.serve<EditorSocketData>({
    port: 0,
    websocket: editorSocketHandlers(deps),
    fetch: (req, srv) => {
      const sceneId = decodeURIComponent(new URL(req.url).pathname.split("/")[2] ?? "");
      return handleEditorUpgrade(req, srv, sceneId, deps);
    },
  });
  return {
    sessionTokens,
    sceneDocuments,
    url: (token: string, sceneId = "s1") => `ws://localhost:${server!.port}/scene/${sceneId}/edit?token=${token}`,
  };
}

/** A socket whose messages are read in order. */
async function connect(url: string) {
  const socket = new WebSocket(url);
  const inbox: any[] = [];
  const waiting: Array<(m: any) => void> = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const next = waiting.shift();
    if (next) {
      next(message);
    } else {
      inbox.push(message);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  return {
    socket,
    next: () => (inbox.length > 0 ? Promise.resolve(inbox.shift()) : new Promise<any>((r) => waiting.push(r))),
    send: (message: unknown) => socket.send(JSON.stringify(message)),
  };
}

describe("editor socket", () => {
  it("opens with both versions, then answers a submit with its ops and an ack", async () => {
    const { sessionTokens, url } = start();
    const editor = await connect(url(await sessionTokens.mintEditor({ sceneId: "s1" })));
    expect(await editor.next()).toMatchObject({ type: "snapshot", version: "published", snapshot: { seq: 0 } });
    expect(await editor.next()).toMatchObject({ type: "snapshot", version: "draft", hasDraft: false });

    editor.send({
      type: "submit",
      version: "draft",
      base: 0,
      opId: "op-1",
      ops: [{ p: ["widgets", "a", "x"], od: 0, oi: 40 }],
    });
    expect(await editor.next()).toMatchObject({ type: "ops", version: "draft", seq: 1, opId: "op-1", hasDraft: true });
    expect(await editor.next()).toEqual({ type: "ack", opId: "op-1", version: "draft", seq: 1 });
    editor.socket.close();
  });

  it("rejects ops that leave the scene's shape, and resends the snapshot for a stale base", async () => {
    const { sessionTokens, url } = start();
    const editor = await connect(url(await sessionTokens.mintEditor({ sceneId: "s1" })));
    await editor.next();
    await editor.next();
    editor.send({ type: "submit", version: "draft", base: 0, opId: "bad", ops: [{ p: ["nope"], oi: 1 }] });
    expect(await editor.next()).toMatchObject({ type: "reject", opId: "bad", error: "invalid" });
    editor.send({
      type: "submit",
      version: "draft",
      base: 9,
      opId: "late",
      ops: [{ p: ["widgets", "a", "x"], od: 0, oi: 1 }],
    });
    expect(await editor.next()).toMatchObject({ type: "reject", opId: "late", error: "resync" });
    expect(await editor.next()).toMatchObject({ type: "snapshot", version: "draft" });
    editor.socket.close();
  });

  it("publishes the draft", async () => {
    const { sessionTokens, url } = start();
    const editor = await connect(url(await sessionTokens.mintEditor({ sceneId: "s1" })));
    await editor.next();
    await editor.next();
    editor.send({
      type: "submit",
      version: "draft",
      base: 0,
      opId: "op-1",
      ops: [{ p: ["widgets", "a", "x"], od: 0, oi: 40 }],
    });
    await editor.next();
    await editor.next();
    editor.send({ type: "publish" });
    expect(await editor.next()).toMatchObject({ type: "ops", version: "published", seq: 1, opId: null });
    expect(await editor.next()).toEqual({ type: "published", hasDraft: false });
    editor.socket.close();
  });

  it("refuses an overlay's session, and a token for another scene", async () => {
    const { sessionTokens } = start();
    const http = (token: string) => `http://localhost:${server!.port}/scene/s1/edit?token=${token}`;
    expect((await fetch(http(await sessionTokens.mint({ sceneId: "s1" })))).status).toBe(401);
    expect((await fetch(http(await sessionTokens.mintEditor({ sceneId: "s2" })))).status).toBe(401);
    expect((await fetch(http("garbage"))).status).toBe(401);
  });
});

describe("editor socket — errors", () => {
  it("names the open as what a missing scene's error answers, and closes", async () => {
    const { sessionTokens, url } = start();
    const editor = await connect(url(await sessionTokens.mintEditor({ sceneId: "gone" }), "gone"));
    const closed = new Promise<number>((resolve) => editor.socket.addEventListener("close", (e) => resolve(e.code)));
    expect(await editor.next()).toEqual({ type: "error", for: "open", reason: "not_found" });
    expect(await closed).toBe(4404);
  });

  it("names the failed submit by its op id and version", async () => {
    const { sessionTokens, sceneDocuments, url } = start();
    const editor = await connect(url(await sessionTokens.mintEditor({ sceneId: "s1" })));
    await editor.next();
    await editor.next();
    sceneDocuments.submit = async () => {
      throw new Error("boom");
    };
    editor.send({ type: "submit", version: "draft", base: 0, opId: "op-9", ops: [] });
    expect(await editor.next()).toEqual({
      type: "error",
      for: "submit",
      reason: "failed",
      opId: "op-9",
      version: "draft",
    });
    editor.socket.close();
  });

  it("names a failed publish and discard", async () => {
    const { sessionTokens, sceneDocuments, url } = start();
    const editor = await connect(url(await sessionTokens.mintEditor({ sceneId: "s1" })));
    await editor.next();
    await editor.next();
    sceneDocuments.publish = async () => {
      throw new Error("boom");
    };
    sceneDocuments.discard = async () => {
      throw new Error("boom");
    };
    editor.send({ type: "publish" });
    expect(await editor.next()).toEqual({ type: "error", for: "publish", reason: "failed" });
    editor.send({ type: "discard" });
    expect(await editor.next()).toEqual({ type: "error", for: "discard", reason: "failed" });
    editor.socket.close();
  });

  it("gives a submit without a usable op id or version a null op id and no version", () => {
    expect(failedMessageError({ type: "submit", version: "nope", opId: 7 })).toEqual({
      type: "error",
      for: "submit",
      reason: "failed",
      opId: null,
    });
  });
});

describe("editor socket — presence", () => {
  async function opened(url: string) {
    const editor = await connect(url);
    await editor.next();
    await editor.next();
    return editor;
  }

  it("tells the other editors what one has selected, and that it left", async () => {
    const { sessionTokens, url } = start();
    const token = await sessionTokens.mintEditor({ sceneId: "s1" });
    const one = await opened(url(token));
    const two = await opened(url(token));

    one.send({ type: "presence", name: " Wolfy ", selection: "a" });
    const seen = await two.next();
    expect(seen).toMatchObject({ type: "presence", name: "Wolfy", selection: "a" });
    expect(typeof seen.editorId).toBe("string");

    one.socket.close();
    expect(await two.next()).toEqual({ type: "presence", editorId: seen.editorId, left: true });
    two.socket.close();
  });

  it("shows a newcomer what the others already have selected", async () => {
    const { sessionTokens, url } = start();
    const token = await sessionTokens.mintEditor({ sceneId: "s1" });
    const one = await opened(url(token));
    const two = await opened(url(token));
    one.send({ type: "presence", name: "Wolfy", selection: "a" });
    await two.next();

    const three = await connect(url(token));
    await three.next();
    await three.next();
    expect(await three.next()).toMatchObject({ type: "presence", name: "Wolfy", selection: "a" });
    for (const editor of [one, two, three]) {
      editor.socket.close();
    }
  });

  it("ignores a selection that is not a placement id", async () => {
    const { sessionTokens, url } = start();
    const token = await sessionTokens.mintEditor({ sceneId: "s1" });
    const one = await opened(url(token));
    const two = await opened(url(token));
    one.send({ type: "presence", name: "Wolfy", selection: 42 });
    one.send({ type: "presence", name: "Wolfy", selection: null });
    expect(await two.next()).toMatchObject({ type: "presence", selection: null });
    one.socket.close();
    two.socket.close();
  });
});
