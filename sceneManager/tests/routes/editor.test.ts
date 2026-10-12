import { afterEach, describe, expect, it } from "bun:test";
import { type EditorSocketData, editorSocketHandlers, handleEditorUpgrade } from "../../src/routes/editor";
import { SceneDocuments } from "../../src/scene/scene-documents";
import { SessionTokenService } from "../../src/scene/session-token";
import { FakeSceneStore, sceneRow, storedPlacement } from "../scene/fake-scene-store";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as never;

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

function start() {
  const sessionTokens = new SessionTokenService("test-secret");
  const sceneDocuments = new SceneDocuments(
    new FakeSceneStore([sceneRow("s1", [storedPlacement("a")])]),
    { broadcast: () => {}, connectedSceneIds: () => [] },
    logger
  );
  const deps = { sessionTokens, sceneDocuments, logger };
  server = Bun.serve<EditorSocketData>({
    port: 0,
    websocket: editorSocketHandlers(deps),
    fetch: (req, srv) => handleEditorUpgrade(req, srv, new URL(req.url).pathname.split("/")[2]!, deps),
  });
  const base = `localhost:${server.port}`;
  return {
    sessionTokens,
    url: (token: string, scene = "s1", protocol = "2") =>
      `ws://${base}/scene/${scene}/edit?token=${token}&protocol=${protocol}`,
    http: (token: string, query = "&protocol=2") => `http://${base}/scene/s1/edit?token=${token}${query}`,
  };
}

/** A socket whose messages are read in order, and whose close is recorded. */
async function connect(url: string) {
  const socket = new WebSocket(url);
  const inbox: any[] = [];
  const waiting: Array<(m: any) => void> = [];
  let closed: { code: number } | null = null;
  const closing = new Promise<{ code: number }>((resolve) => {
    socket.addEventListener("close", (event) => {
      closed = { code: event.code };
      resolve(closed);
    });
  });
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
    closed: () => closing,
    isClosed: () => closed !== null,
  };
}

const hello = (clientId: string, name = clientId) => ({ type: "hello", protocol: 2, clientId, have: null, name });

describe("editor socket — protocol 2", () => {
  it("welcomes a hello and answers an item with its entry", async () => {
    const { sessionTokens, url } = start();
    const editor = await connect(url(await sessionTokens.mintEditor({ sceneId: "s1" })));
    editor.send(hello("c1"));
    expect(await editor.next()).toMatchObject({ type: "welcome", protocol: 2, clientId: "c1", last: null });
    editor.send({
      type: "item",
      seq: 1,
      base: 0,
      body: { kind: "edit", version: "draft", ops: [{ p: ["widgets", "a", "x"], od: 0, oi: 40 }] },
    });
    expect(await editor.next()).toMatchObject({ type: "entry", v: 1, src: { clientId: "c1", seq: 1 }, hasDraft: true });
    editor.send({ type: "item", seq: 1, base: 0, body: { kind: "publish" } });
    expect(await editor.next()).toEqual({ type: "ack", seq: 1, v: 1 });
    editor.socket.close();
  });

  it("refuses a socket without protocol 2, an overlay's session, and a token for another scene", async () => {
    const { sessionTokens, http } = start();
    const editorToken = await sessionTokens.mintEditor({ sceneId: "s1" });
    expect((await fetch(http(editorToken, ""))).status).toBe(426);
    expect((await fetch(http(editorToken, "&protocol=1"))).status).toBe(426);
    expect((await fetch(http(await sessionTokens.mint({ sceneId: "s1" })))).status).toBe(401);
    expect((await fetch(http(await sessionTokens.mintEditor({ sceneId: "s2" })))).status).toBe(401);
    expect((await fetch(http("garbage"))).status).toBe(401);
  });

  it("ends a session that does not start with hello, or says hello twice, as a protocol error", async () => {
    const { sessionTokens, url } = start();
    const token = await sessionTokens.mintEditor({ sceneId: "s1" });
    const first = await connect(url(token));
    first.send({ type: "presence", selection: null, version: "draft" });
    expect(await first.next()).toMatchObject({ type: "error", code: "protocol" });
    expect((await first.closed()).code).toBe(4400);

    const twice = await connect(url(token));
    twice.send(hello("c1"));
    await twice.next();
    twice.send(hello("c1"));
    expect(await twice.next()).toMatchObject({ type: "error", code: "protocol" });
    expect((await twice.closed()).code).toBe(4400);
  });

  it("ends a session whose hello asks for another protocol", async () => {
    const { sessionTokens, url } = start();
    const editor = await connect(url(await sessionTokens.mintEditor({ sceneId: "s1" })));
    editor.send({ ...hello("c1"), protocol: 3 });
    expect(await editor.next()).toMatchObject({ type: "error", code: "unsupported_protocol" });
    expect((await editor.closed()).code).toBe(4426);
  });

  it("ends a session on a scene that does not exist as not_found", async () => {
    const { sessionTokens } = start();
    const token = await sessionTokens.mintEditor({ sceneId: "gone" });
    const editor = await connect(`ws://localhost:${server!.port}/scene/gone/edit?token=${token}&protocol=2`);
    editor.send(hello("c1"));
    expect(await editor.next()).toMatchObject({ type: "error", code: "not_found" });
    expect((await editor.closed()).code).toBe(4404);
  });

  it("closes the older socket of a client that says hello again on a new one", async () => {
    const { sessionTokens, url } = start();
    const token = await sessionTokens.mintEditor({ sceneId: "s1" });
    const old = await connect(url(token));
    old.send(hello("c1"));
    await old.next();
    const fresh = await connect(url(token));
    fresh.send(hello("c1"));
    expect(await fresh.next()).toMatchObject({ type: "welcome" });
    expect((await old.closed()).code).toBe(4409);
    fresh.socket.close();
  });

  it("handles messages sent right behind the hello in order", async () => {
    const { sessionTokens, url } = start();
    const editor = await connect(url(await sessionTokens.mintEditor({ sceneId: "s1" })));
    editor.send(hello("c1"));
    for (let seq = 1; seq <= 3; seq++) {
      editor.send({
        type: "item",
        seq,
        base: seq - 1,
        body: { kind: "edit", version: "draft", ops: [{ p: ["widgets", "a", "x"], od: seq - 1, oi: seq }] },
      });
    }
    expect(await editor.next()).toMatchObject({ type: "welcome" });
    for (let seq = 1; seq <= 3; seq++) {
      expect(await editor.next()).toMatchObject({ type: "entry", v: seq, src: { seq } });
    }
    editor.socket.close();
  });
});

describe("editor socket — presence", () => {
  async function opened(url: string, clientId: string) {
    const editor = await connect(url);
    editor.send(hello(clientId, `name-${clientId}`));
    await editor.next();
    return editor;
  }

  it("tells the other editors what one has selected, and that it left", async () => {
    const { sessionTokens, url } = start();
    const token = await sessionTokens.mintEditor({ sceneId: "s1" });
    const one = await opened(url(token), "c1");
    const two = await opened(url(token), "c2");

    one.send({ type: "presence", selection: "a", version: "draft" });
    expect(await two.next()).toEqual({
      type: "presence",
      clientId: "c1",
      name: "name-c1",
      selection: "a",
      version: "draft",
    });

    one.socket.close();
    expect(await two.next()).toEqual({ type: "presence", clientId: "c1", left: true });
    two.socket.close();
  });

  it("shows a newcomer what the others already have selected", async () => {
    const { sessionTokens, url } = start();
    const token = await sessionTokens.mintEditor({ sceneId: "s1" });
    const one = await opened(url(token), "c1");
    const two = await opened(url(token), "c2");
    one.send({ type: "presence", selection: "a", version: "published" });
    await two.next();

    const three = await connect(url(token));
    three.send(hello("c3"));
    await three.next();
    expect(await three.next()).toMatchObject({ type: "presence", clientId: "c1", selection: "a" });
    for (const editor of [one, two, three]) {
      editor.socket.close();
    }
  });
});
