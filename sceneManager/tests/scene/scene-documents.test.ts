import { describe, expect, it } from "bun:test";
import type { EntryRef, ItemBody, ServerMessage, Version } from "@woofx3/api/scene-editor";
import { applyOps } from "../../public/scene-manager/scene-document";
import {
  documentOf,
  type EditorConnection,
  type ItemReply,
  SceneDocuments,
  type SceneDocumentsClock,
  storedSceneOf,
} from "../../src/scene/scene-documents";
import type { OverlaySceneState, OverlayWidgetInstance } from "../../src/scene/scene-host";
import { FakeSceneStore, type SceneRow, type StoreHooks, sceneRow, storedPlacement } from "./fake-scene-store";

const AUTOSAVE_MS = 2000;

/** Timers that run only when the test moves time forward. */
class TestClock implements SceneDocumentsClock {
  time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) {
        break;
      }
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].callback();
      await settle();
    }
    this.time = end;
    await settle();
  }
}

/** Let every pending promise callback run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

const silent = { debug() {}, info() {}, warn() {}, error() {} } as never;

function recordingLogger() {
  const errors: string[] = [];
  return {
    errors,
    logger: {
      debug() {},
      info() {},
      warn() {},
      error(message: string) {
        errors.push(message);
      },
    } as never,
  };
}

/** An editor socket that keeps what it was sent. */
class Socket implements EditorConnection {
  readonly inbox: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;

  send(message: ServerMessage): void {
    this.inbox.push(structuredClone(message));
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  take(): ServerMessage[] {
    return this.inbox.splice(0);
  }
}

function setup(rows: SceneRow[] = [sceneRow("s1", [storedPlacement("a")])], hooks: StoreHooks = {}) {
  const store = new FakeSceneStore(rows, hooks);
  const clock = new TestClock();
  const overlays: Array<{ sceneId: string; data: any }> = [];
  let connected = ["s1"];
  let epochs = 0;
  const make = (logger = silent) =>
    new SceneDocuments(
      store,
      {
        broadcast: (sceneId, _event, data) => overlays.push({ sceneId, data }),
        connectedSceneIds: () => connected,
      },
      logger,
      { persister: store, clock, newEpoch: () => `epoch${++epochs}` }
    );
  const documents = make();
  return {
    store,
    clock,
    documents,
    make,
    overlays,
    published: () => overlays.filter((o) => o.data.version === "published").map((o) => o.data),
    drafts: () => overlays.filter((o) => o.data.version === "draft").map((o) => o.data),
    disconnect: () => {
      connected = [];
    },
  };
}

async function open(documents: SceneDocuments, clientId: string, have: EntryRef | null = null, name = clientId) {
  const socket = new Socket();
  await documents.openEditor("s1", { clientId, have, name }, socket);
  return socket;
}

async function submit(
  documents: SceneDocuments,
  clientId: string,
  seq: number,
  base: number,
  body: ItemBody
): Promise<ItemReply[]> {
  const replies: ItemReply[] = [];
  await documents.submitItem("s1", clientId, seq, base, body, (reply) => replies.push(reply));
  return replies;
}

const edit = (version: Version, ops: unknown[]): ItemBody => ({ kind: "edit", version, ops: ops as never });
const x = (id: string, from: number, to: number) => ({ p: ["widgets", id, "x"], od: from, oi: to });
const entries = (socket: Socket) => socket.take().filter((m) => m.type === "entry") as any[];

describe("SceneDocuments — overlays and saves made elsewhere", () => {
  it("loads a scene once and starts each version's overlays at seq 0", async () => {
    const { documents } = setup();
    const first = await documents.snapshot("s1");
    await documents.snapshot("s1", "draft");
    expect(first!.seq).toBe(0);
    expect(first!.doc.widgets.a!.settings).toEqual({ text: "hi" });
    expect(first!.meta.a!.frameUrl).toBe("/frames/woofx3:widget:text");
  });

  it("pushes a save as published ops for the next seq, and mirrors it into a scene with no draft", async () => {
    const { documents, store, published, drafts } = setup();
    const before = await documents.snapshot("s1");
    store.rows.get("s1")!.widgetsJson = JSON.stringify([
      storedPlacement("a", { position: { x: 5, y: 0 }, settings: { text: "hi there" } }),
    ]);
    await documents.refresh("s1");

    expect(published()).toHaveLength(1);
    expect(published()[0].seq).toBe(1);
    const after = await documents.snapshot("s1");
    expect(applyOps(before!.doc, published()[0].ops)).toEqual(after!.doc);
    expect((await documents.snapshot("s1", "draft"))!.doc).toEqual(after!.doc);
    expect(drafts()).toHaveLength(1);
  });

  it("sends the meta of placements added, and null for one removed", async () => {
    const { documents, store, published } = setup([sceneRow("s1", [storedPlacement("a"), storedPlacement("b")])]);
    await documents.snapshot("s1");
    store.rows.get("s1")!.widgetsJson = JSON.stringify([
      storedPlacement("a"),
      storedPlacement("c", { widgetCanonicalId: "woofx3:widget:image" }),
    ]);
    await documents.refresh("s1");
    expect(published()[0].meta).toEqual({
      b: null,
      c: { moduleId: "woofx3", hostsSurface: "", frameUrl: "/frames/woofx3:widget:image", linkedResources: {} },
    });
  });

  it("sends meta that changed with no document change to overlays and editors", async () => {
    const { documents, store, published } = setup();
    const socket = await open(documents, "c1");
    socket.take();
    store.frameVersion = "2";
    await documents.refresh("s1");
    const frame = {
      moduleId: "woofx3",
      hostsSurface: "",
      frameUrl: "/frames/woofx3:widget:text?v=2",
      linkedResources: {},
    };
    expect(published()).toEqual([{ version: "published", seq: 1, ops: [], meta: { a: frame } }]);
    expect(entries(socket)).toEqual([
      expect.objectContaining({ kind: "external", changes: {}, meta: { published: { a: frame } } }),
    ]);
  });

  it("never rejects a refresh whose read fails", async () => {
    let failReads = false;
    const { documents } = setup(undefined, {
      beforeRead: async () => {
        if (failReads) {
          throw new Error("db down");
        }
      },
    });
    await documents.snapshot("s1");
    failReads = true;
    await expect(documents.refresh("s1")).resolves.toBeUndefined();
  });

  it("sends nothing for a save that changed nothing", async () => {
    const { documents, overlays } = setup();
    await documents.snapshot("s1");
    await documents.refresh("s1");
    expect(overlays).toEqual([]);
  });

  it("ignores a save of a scene nobody has open, and drops one whose overlays left", async () => {
    const { documents, overlays, disconnect } = setup();
    await documents.refresh("s1");
    expect(documents.seqOf("s1")).toBe(0);

    await documents.snapshot("s1");
    disconnect();
    await documents.refresh("s1");
    expect(overlays).toEqual([]);
  });
});

describe("SceneDocuments — items", () => {
  it("welcomes a new editor with a snapshot and its empty watermark", async () => {
    const { documents } = setup();
    const socket = await open(documents, "c1");
    expect(socket.take()).toEqual([
      expect.objectContaining({ type: "welcome", protocol: 2, clientId: "c1", last: null, diverged: false }),
    ]);
  });

  it("commits a draft edit as one entry to every editor, the submitter's src as its answer", async () => {
    const { documents, drafts, published } = setup();
    const one = await open(documents, "c1");
    const two = await open(documents, "c2");
    one.take();
    two.take();
    expect(await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 40)]))).toEqual([]);
    const [entry] = entries(one);
    expect(entry).toMatchObject({
      v: 1,
      id: "epoch1.1",
      src: { clientId: "c1", seq: 1 },
      kind: "edit",
      hasDraft: true,
    });
    expect(entries(two)).toEqual([entry]);
    expect(drafts()).toEqual([{ version: "draft", seq: 1, ops: [x("a", 0, 40)], meta: {} }]);
    expect(published()).toEqual([]);
    expect(documents.hasDraft("s1")).toBe(true);
  });

  it("transforms an item made against an older entry, so concurrent typing keeps both edits", async () => {
    const { documents } = setup();
    const at = (pos: number, si: string) => ({ p: ["widgets", "a", "settings", "text", pos], si });
    await submit(documents, "c1", 1, 0, edit("draft", [at(2, "!")]));
    await submit(documents, "c2", 1, 0, edit("draft", [at(0, "Oh ")]));
    expect((await documents.snapshot("s1", "draft"))!.doc.widgets.a!.settings.text).toBe("Oh hi!");
  });

  it("answers a resent item once: ack when applied, the same nack when refused", async () => {
    const { documents } = setup();
    const socket = await open(documents, "c1");
    socket.take();
    await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 40)]));
    expect(await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 40)]))).toEqual([
      { type: "ack", seq: 1, v: 1 },
    ]);
    expect(entries(socket)).toHaveLength(1);

    const bad = edit("draft", [{ p: ["secrets"], oi: 1 }]);
    expect(await submit(documents, "c1", 2, 1, bad)).toEqual([
      expect.objectContaining({ type: "nack", seq: 2, code: "invalid", retryable: false }),
    ]);
    expect(await submit(documents, "c1", 2, 1, bad)).toEqual([
      expect.objectContaining({ type: "nack", seq: 2, code: "invalid" }),
    ]);
    expect((await documents.snapshot("s1", "draft"))!.doc.widgets.a!.x).toBe(40);
  });

  it("refuses an item based on an entry the scene does not have as stale_base", async () => {
    const { documents } = setup();
    expect(await submit(documents, "c1", 1, 5, edit("draft", [x("a", 0, 1)]))).toEqual([
      expect.objectContaining({ type: "nack", code: "stale_base", retryable: true }),
    ]);
  });

  it("acks an edit that transforms to nothing without an entry", async () => {
    const { documents } = setup();
    const removed = (await documents.snapshot("s1", "draft"))!.doc.widgets.a;
    await submit(documents, "c1", 1, 0, edit("draft", [{ p: ["widgets", "a"], od: removed }]));
    const replies = await submit(documents, "c2", 1, 0, edit("draft", [x("a", 0, 7)]));
    expect(replies).toEqual([{ type: "ack", seq: 1, v: 1 }]);
  });

  it("commits a live edit and its copy into the draft as one entry, published first for overlays", async () => {
    const { documents, overlays } = setup();
    const socket = await open(documents, "c1");
    socket.take();
    await submit(documents, "c1", 1, 0, edit("draft", [{ p: ["widgets", "a", "y"], od: 0, oi: 70 }]));
    await submit(documents, "c1", 2, 1, edit("published", [x("a", 0, 40)]));
    const live = entries(socket)[1];
    expect(Object.keys(live.changes).sort()).toEqual(["draft", "published"]);
    expect(overlays.slice(-2).map((o) => o.data.version)).toEqual(["published", "draft"]);
    const draft = (await documents.snapshot("s1", "draft"))!.doc.widgets.a!;
    expect([draft.x, draft.y]).toEqual([40, 70]);
  });

  it("publishes the draft and discards it as entries, even when there is nothing to change", async () => {
    const { documents, published } = setup();
    const socket = await open(documents, "c1");
    socket.take();
    await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 40)]));
    await submit(documents, "c1", 2, 1, { kind: "publish" });
    expect(published()[0]).toMatchObject({ seq: 1, ops: [x("a", 0, 40)] });
    expect(documents.hasDraft("s1")).toBe(false);
    await submit(documents, "c1", 3, 2, { kind: "discard" });
    expect(entries(socket).map((e) => [e.kind, e.hasDraft])).toEqual([
      ["edit", true],
      ["publish", false],
      ["discard", false],
    ]);
  });

  it("commits an item whose framing fails, and frames the placement with a later change", async () => {
    let failFraming = true;
    const { documents, store, drafts } = setup(undefined, {
      beforeFrame: async () => {
        if (failFraming) {
          throw new Error("barkloader down");
        }
      },
    });
    const draft = (await documents.snapshot("s1", "draft"))!.doc;
    const added = { ...draft.widgets.a!, widget: "woofx3:widget:image", z: "a0001" };
    expect(await submit(documents, "c1", 1, 0, edit("draft", [{ p: ["widgets", "b"], oi: added }]))).toEqual([]);
    expect((await documents.snapshot("s1", "draft"))!.meta.b).toBeUndefined();

    failFraming = false;
    await submit(documents, "c1", 2, 1, edit("draft", [x("a", 0, 1)]));
    expect(drafts()[1].meta.b.frameUrl).toBe("/frames/woofx3:widget:image");
    expect(store.frameCalls).toBe(2);
  });

  it("answers unavailable when the scene cannot be read, changing nothing", async () => {
    let failReads = true;
    const { documents } = setup(undefined, {
      beforeRead: async () => {
        if (failReads) {
          throw new Error("db down");
        }
      },
    });
    expect(await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 1)]))).toEqual([
      expect.objectContaining({ type: "nack", code: "unavailable", retryable: true }),
    ]);
    failReads = false;
    expect(await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 1)]))).toEqual([]);
  });
});

describe("SceneDocuments — editors", () => {
  it("catches a reconnecting editor up from the entry it has", async () => {
    const { documents } = setup();
    const first = await open(documents, "c1");
    first.take();
    await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 1)]));
    await submit(documents, "c2", 1, 1, edit("draft", [x("a", 1, 2)]));
    const [one] = entries(first);
    const again = await open(documents, "c1", { v: one.v, id: one.id });
    const [welcome] = again.take() as any[];
    expect(welcome.last).toEqual({ seq: 1, outcome: "applied" });
    expect(welcome.catchup.map((e: any) => e.v)).toEqual([2]);
  });

  it("tells an editor that applied an entry the scene does not have that it diverged", async () => {
    const { documents } = setup();
    const socket = await open(documents, "c1", { v: 9, id: "gone.9" });
    expect(socket.take()[0]).toMatchObject({ type: "welcome", diverged: true });
  });

  it("closes an older socket of the same client as replaced, and stops sending to it", async () => {
    const { documents } = setup();
    const old = await open(documents, "c1");
    const fresh = await open(documents, "c1");
    expect(old.closed).toEqual({ code: 4409, reason: expect.any(String) });
    old.take();
    fresh.take();
    await submit(documents, "c2", 1, 0, edit("draft", [x("a", 0, 1)]));
    expect(entries(old)).toEqual([]);
    expect(entries(fresh)).toHaveLength(1);
    await documents.closeEditor("s1", "c1", old);
    await submit(documents, "c2", 2, 1, edit("draft", [x("a", 1, 2)]));
    expect(entries(fresh)).toHaveLength(1);
  });

  it("answers an unknown scene with not_found and closes", async () => {
    const { documents } = setup();
    const socket = new Socket();
    await documents.openEditor("nope", { clientId: "c1", have: null, name: "" }, socket);
    expect(socket.take()).toEqual([{ type: "error", code: "not_found", detail: expect.any(String) }]);
    expect(socket.closed?.code).toBe(4404);
  });

  it("relays presence by client id, hides an editor that is away, and says when one leaves", async () => {
    const { documents } = setup();
    const one = await open(documents, "c1", null, "Wolfy");
    const two = await open(documents, "c2", null, "Pup");
    one.take();
    two.take();
    await documents.editorPresence("s1", "c1", one, { selection: "a", version: "draft" });
    expect(two.take()).toEqual([{ type: "presence", clientId: "c1", name: "Wolfy", selection: "a", version: "draft" }]);

    const three = await open(documents, "c3");
    expect(three.take().slice(1)).toEqual([
      { type: "presence", clientId: "c1", name: "Wolfy", selection: "a", version: "draft" },
    ]);

    await documents.editorPresence("s1", "c1", one, { away: true });
    expect(two.take()).toEqual([{ type: "presence", clientId: "c1", left: true }]);
    const four = await open(documents, "c4");
    expect(four.take()).toHaveLength(1);

    await documents.closeEditor("s1", "c2", two);
    expect(one.take()).toEqual([{ type: "presence", clientId: "c2", left: true }]);
  });
});

describe("SceneDocuments — writing back", () => {
  it("writes documents and editor state in one write, once per autosave window", async () => {
    const { documents, store, clock } = setup();
    await open(documents, "c1");
    await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 1)]));
    await clock.advance(AUTOSAVE_MS / 2);
    await submit(documents, "c1", 2, 1, edit("draft", [x("a", 1, 2)]));
    expect(store.writes).toEqual([]);
    await clock.advance(AUTOSAVE_MS / 2);
    expect(store.writes).toHaveLength(1);
    const [write] = store.writes;
    expect(Object.keys(write!).sort()).toEqual([
      "draftLayoutJson",
      "draftWidgetsJson",
      "editorStateJson",
      "id",
      "layoutJson",
      "widgetsJson",
    ]);
    expect(JSON.parse(write!.draftWidgetsJson!)[0].position).toEqual({ x: 2, y: 0 });
    expect(JSON.parse(write!.editorStateJson!)).toMatchObject({
      v: 2,
      headId: "epoch1.2",
      clients: { c1: { seq: 2, outcome: "applied" } },
    });
  });

  it("writes no draft once it is published", async () => {
    const { documents, store, clock } = setup();
    await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 1)]));
    await submit(documents, "c1", 2, 1, { kind: "publish" });
    await clock.advance(AUTOSAVE_MS);
    expect(store.writes.at(-1)).toMatchObject({ clearDraft: true });
    expect(store.rows.get("s1")!.draftWidgetsJson).toBeNull();
  });

  it("retries a failed write with the next window", async () => {
    let fail = true;
    const { documents, store, clock } = setup(undefined, {
      beforeWrite: async () => {
        if (fail) {
          fail = false;
          throw new Error("db down");
        }
      },
    });
    await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 1)]));
    await clock.advance(AUTOSAVE_MS);
    expect(store.writes).toEqual([]);
    await clock.advance(AUTOSAVE_MS);
    expect(store.writes).toHaveLength(1);
  });

  it("resumes after a restart where it stopped: an editor at the head catches up with nothing", async () => {
    const { documents, make } = setup();
    const socket = await open(documents, "c1");
    await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 1)]));
    const [entry] = entries(socket);
    await documents.close();

    const restarted = make();
    const again = await open(restarted, "c1", { v: entry.v, id: entry.id });
    expect(again.take()[0]).toMatchObject({ catchup: [], last: { seq: 1, outcome: "applied" } });
    expect(await submit(restarted, "c1", 1, 0, edit("draft", [x("a", 0, 1)]))).toEqual([{ type: "ack", seq: 1, v: 1 }]);
  });

  it("retries the last write when it fails at close", async () => {
    let failures = 2;
    const { documents, store, clock } = setup(undefined, {
      beforeWrite: async () => {
        if (failures > 0) {
          failures--;
          throw new Error("db down");
        }
      },
    });
    await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 1)]));
    const closing = documents.close();
    for (let i = 0; i < 4; i++) {
      await settle();
      await clock.advance(250);
    }
    await closing;
    expect(store.writes).toHaveLength(1);
    expect(JSON.parse(store.rows.get("s1")!.editorStateJson!)).toMatchObject({ v: 1 });
  });

  it("answers items after close as unavailable, changing nothing", async () => {
    const { documents } = setup();
    await documents.close();
    expect(await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 1)]))).toEqual([
      expect.objectContaining({ code: "unavailable" }),
    ]);
  });

  it("tells an editor whose entries a crash lost that its history diverged", async () => {
    const { documents, make, clock } = setup();
    const socket = await open(documents, "c1");
    await clock.advance(AUTOSAVE_MS);
    await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 1)]));
    const [entry] = entries(socket);

    const restarted = make();
    const again = await open(restarted, "c1", { v: entry.v, id: entry.id });
    expect(again.take()[0]).toMatchObject({ diverged: true, last: null });
  });

  it("starts over on a new head when the stored documents are not the ones the state describes", async () => {
    const { documents, make, store } = setup();
    const socket = await open(documents, "c1");
    await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 1)]));
    const [entry] = entries(socket);
    await documents.close();
    const row = store.rows.get("s1")!;
    row.draftWidgetsJson = JSON.stringify([...JSON.parse(row.draftWidgetsJson!), storedPlacement("b")]);

    const restarted = make();
    const again = await open(restarted, "c1", { v: entry.v, id: entry.id });
    expect(again.take()[0]).toMatchObject({ diverged: false, last: { seq: 1 }, snapshot: { v: 2 } });
  });

  it("starts empty and loudly from unreadable editor state", async () => {
    const { store, make } = setup();
    store.rows.get("s1")!.editorStateJson = '{"v":"three"}';
    const { errors, logger } = recordingLogger();
    const documents = make(logger);
    const socket = await open(documents, "c1", { v: 3, id: "old.3" });
    expect(socket.take()[0]).toMatchObject({ diverged: true, snapshot: { v: 0 } });
    expect(errors).toHaveLength(1);
  });

  it("lets edits not yet written win over a save made elsewhere, but not a pending head write", async () => {
    const { documents, store, clock } = setup();
    await open(documents, "c1");
    // Only the editor's head is waiting to be written: the save goes in.
    store.rows.get("s1")!.widgetsJson = JSON.stringify([storedPlacement("a", { position: { x: 9, y: 0 } })]);
    await documents.refresh("s1");
    expect((await documents.snapshot("s1"))!.doc.widgets.a!.x).toBe(9);

    await submit(documents, "c1", 1, 1, edit("published", [x("a", 9, 40)]));
    store.rows.get("s1")!.widgetsJson = JSON.stringify([storedPlacement("a", { position: { x: 3, y: 0 } })]);
    await documents.refresh("s1");
    expect((await documents.snapshot("s1"))!.doc.widgets.a!.x).toBe(40);
    await clock.advance(AUTOSAVE_MS);
    expect(JSON.parse(store.rows.get("s1")!.widgetsJson)[0].position.x).toBe(40);
  });

  it("does not take the database's echo of its own write for a save made elsewhere", async () => {
    const { documents, clock, published } = setup();
    await submit(documents, "c1", 1, 0, edit("published", [x("a", 0, 40)]));
    await clock.advance(AUTOSAVE_MS);
    await documents.refresh("s1");
    expect(published()).toHaveLength(1);
  });

  it("keeps a scene with a write pending, and drops it once written and idle", async () => {
    const { documents, clock, disconnect } = setup();
    await submit(documents, "c1", 1, 0, edit("draft", [x("a", 0, 1)]));
    disconnect();
    await documents.refresh("s1");
    expect(documents.seqOf("s1", "draft")).toBe(1);
    await clock.advance(AUTOSAVE_MS);
    await documents.refresh("s1");
    expect(documents.seqOf("s1", "draft")).toBe(0);
  });
});

describe("documentOf + storedSceneOf", () => {
  function instance(id: string, overrides: Partial<OverlayWidgetInstance> = {}): OverlayWidgetInstance {
    return {
      id,
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
      ...overrides,
    };
  }
  const scene = (instances: OverlayWidgetInstance[]): OverlaySceneState => ({
    sceneId: "s1",
    name: "Main",
    layout: {},
    instances,
  });

  it("writes a scene back as the editor stored it, unknown fields included", () => {
    const stored = {
      id: "a",
      widgetCanonicalId: "woofx3:widget:text",
      name: "Raid banner",
      position: { x: 10, y: 20 },
      size: { width: 300, height: 80 },
      rotation: 15,
      opacity: 0.5,
      zIndex: 0,
      locked: true,
      visible: false,
      settings: { text: "hi" },
      futureField: { keep: "me" },
    };
    const doc = documentOf(
      scene([
        instance("a", {
          stored,
          position: { x: 10, y: 20, width: 300, height: 80 },
          visible: false,
          settings: { text: "hi" },
        }),
      ])
    );
    expect(doc.widgets.a).toMatchObject({ name: "Raid banner", rotation: 15, opacity: 0.5, locked: true });
    expect(doc.widgets.a!.extra).toEqual({ futureField: { keep: "me" } });
    expect(JSON.parse(storedSceneOf(doc).widgetsJson)).toEqual([stored]);
  });

  it("stores placements in stacking order with zIndex to match", () => {
    const doc = documentOf(scene([instance("a"), instance("b")]));
    doc.widgets.a!.z = "a0009";
    const widgets = JSON.parse(storedSceneOf(doc).widgetsJson);
    expect(widgets.map((w: { id: string; zIndex: number }) => [w.id, w.zIndex])).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
  });

  it("gives a placement stored before the editor tracked these fields their defaults", () => {
    const doc = documentOf(scene([instance("a", { stored: { id: "a", widgetCanonicalId: "woofx3:widget:text" } })]));
    expect(doc.widgets.a).toMatchObject({ name: "", rotation: 0, opacity: 1, locked: false, extra: {} });
  });
});
