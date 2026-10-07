import { describe, expect, it, mock } from "bun:test";
import { applyOps } from "../../public/scene-manager/scene-document";
import { type SceneWrite, SceneDocuments, documentOf, storedSceneOf } from "../../src/scene/scene-documents";
import type { OverlaySceneState, OverlayWidgetInstance } from "../../src/scene/scene-host";

function logger() {
  return { debug() {}, info() {}, warn() {}, error() {} } as never;
}

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

function setup(initial: OverlaySceneState, draft?: OverlaySceneState) {
  let saved = initial;
  let savedDraft = draft;
  const loads = mock(async (_sceneId: string, version?: string) =>
    version === "draft" ? (savedDraft ?? saved) : { ...saved, hasDraft: savedDraft !== undefined }
  );
  const framePlacements = mock(async (_sceneId: string, entries: unknown[]) =>
    (entries as Array<{ id: string; widgetCanonicalId: string }>).map((e) =>
      instance(e.id, { widgetCanonicalId: e.widgetCanonicalId, frameUrl: `/frames/for/${e.widgetCanonicalId}` })
    )
  );
  const sent: Array<{ sceneId: string; event: string; data: any }> = [];
  const writes: SceneWrite[] = [];
  let connected = ["s1"];
  const documents = new SceneDocuments(
    { loadFramedSceneById: loads, framePlacements },
    {
      broadcast: (sceneId, event, data) => sent.push({ sceneId, event, data }),
      connectedSceneIds: () => connected,
    },
    logger(),
    {
      autosaveMs: 5,
      persister: {
        updateScene: async (write) => {
          writes.push(write);
        },
      },
    }
  );
  return {
    documents,
    loads,
    framePlacements,
    sent,
    writes,
    published: () => sent.filter((s) => s.data.version === "published").map((s) => s.data),
    drafts: () => sent.filter((s) => s.data.version === "draft").map((s) => s.data),
    save: (state: OverlaySceneState) => {
      saved = state;
    },
    disconnect: () => {
      connected = [];
    },
  };
}

const scene = (instances: OverlayWidgetInstance[]): OverlaySceneState => ({
  sceneId: "s1",
  name: "Main",
  layout: {},
  instances,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const x = (id: string, from: number, to: number) => ({ p: ["widgets", id, "x"], od: from, oi: to });

describe("SceneDocuments — loading and saves made elsewhere", () => {
  it("loads both versions of a scene once and starts each at seq 0", async () => {
    const { documents, loads } = setup(scene([instance("a")]));
    const first = await documents.snapshot("s1");
    await documents.snapshot("s1", "draft");
    expect(loads).toHaveBeenCalledTimes(2);
    expect(first!.seq).toBe(0);
    expect(first!.doc.widgets.a!.settings).toEqual({ text: "hi" });
    expect(first!.meta.a!.frameUrl).toBe("/frames/woofx3/text?v=1");
  });

  it("pushes a save as published ops for the next seq, and mirrors it into a scene with no draft", async () => {
    const { documents, save, published, drafts } = setup(scene([instance("a")]));
    const before = await documents.snapshot("s1");
    save(scene([instance("a", { settings: { text: "hi there" }, position: { x: 5, y: 0, width: 100, height: 50 } })]));
    await documents.refresh("s1");

    expect(published()).toHaveLength(1);
    expect(published()[0].seq).toBe(1);
    const after = await documents.snapshot("s1");
    expect(applyOps(before!.doc, published()[0].ops)).toEqual(after!.doc);
    expect((await documents.snapshot("s1", "draft"))!.doc).toEqual(after!.doc);
    expect(drafts()).toHaveLength(1);
  });

  it("sends the meta of placements whose frame changed, and null for one removed", async () => {
    const { documents, save, published } = setup(scene([instance("a"), instance("b")]));
    await documents.snapshot("s1");
    save(scene([instance("a", { frameUrl: "/frames/woofx3/text?v=2" })]));
    await documents.refresh("s1");
    expect(published()[0].meta).toEqual({
      a: { moduleId: "woofx3", hostsSurface: "", frameUrl: "/frames/woofx3/text?v=2", linkedResources: {} },
      b: null,
    });
  });

  it("sends nothing for a save that changed nothing", async () => {
    const { documents, sent } = setup(scene([instance("a")]));
    await documents.snapshot("s1");
    await documents.refresh("s1");
    expect(sent).toEqual([]);
  });

  it("ignores a save of a scene nobody has open, and drops one whose overlays left", async () => {
    const { documents, loads, sent, disconnect } = setup(scene([instance("a")]));
    await documents.refresh("s1");
    expect(loads).not.toHaveBeenCalled();

    await documents.snapshot("s1");
    disconnect();
    await documents.refresh("s1");
    expect(sent).toEqual([]);
    expect(documents.seqOf("s1")).toBe(0);
  });
});

describe("SceneDocuments — editors", () => {
  it("applies an editor's ops to the draft, tells its editors with the op id, and makes a draft", async () => {
    const { documents, drafts, published } = setup(scene([instance("a")]));
    const heard: any[] = [];
    await documents.subscribeEditor("s1", (event) => heard.push(event));
    const result = await documents.submit("s1", "draft", 0, [x("a", 0, 40)], "op-1");
    expect(result).toEqual({ ok: true, seq: 1 });
    expect((await documents.snapshot("s1", "draft"))!.doc.widgets.a!.x).toBe(40);
    expect((await documents.snapshot("s1"))!.doc.widgets.a!.x).toBe(0);
    expect(drafts()).toHaveLength(1);
    expect(published()).toHaveLength(0);
    expect(heard).toEqual([expect.objectContaining({ version: "draft", seq: 1, opId: "op-1" })]);
    expect(documents.hasDraft("s1")).toBe(true);
  });

  it("transforms ops made against an older number, so concurrent typing keeps both edits", async () => {
    const { documents } = setup(scene([instance("a", { settings: { text: "Thanks" } })]));
    const at = (pos: number, si: string) => ({ p: ["widgets", "a", "settings", "text", pos], si });
    await documents.submit("s1", "draft", 0, [at(6, "!")], "first");
    const second = await documents.submit("s1", "draft", 0, [at(0, "Big ")], "second");
    expect(second).toEqual({ ok: true, seq: 2 });
    expect((await documents.snapshot("s1", "draft"))!.doc.widgets.a!.settings.text).toBe("Big Thanks!");
  });

  it("refuses ops outside the scene's shape, ahead of it, or older than it keeps", async () => {
    const { documents } = setup(scene([instance("a")]));
    expect(await documents.submit("s1", "draft", 0, [{ p: ["secrets"], oi: 1 }])).toMatchObject({ error: "invalid" });
    expect(await documents.submit("s1", "draft", 0, [{ p: ["widgets", "a", "x"], oi: "far" }])).toMatchObject({
      error: "invalid",
    });
    expect(await documents.submit("s1", "draft", 0, [{ p: ["widgets", "b"], oi: { widget: "w" } }])).toMatchObject({
      error: "invalid",
    });
    expect(await documents.submit("s1", "draft", 5, [x("a", 0, 1)])).toMatchObject({ error: "resync" });
    expect(await documents.submit("s1", "draft", 0, [{ p: ["widgets", "zz", "x"], od: 0, oi: 1 }])).toMatchObject({
      error: "invalid",
    });
  });

  it("frames a placement added by an editor, or whose widget changed", async () => {
    const { documents, framePlacements, drafts } = setup(scene([instance("a")]));
    const draft = await documents.snapshot("s1", "draft");
    const added = { ...draft!.doc.widgets.a!, widget: "woofx3:widget:image", z: "a0001" };
    await documents.submit("s1", "draft", 0, [{ p: ["widgets", "b"], oi: added }]);
    expect(framePlacements).toHaveBeenCalledTimes(1);
    expect(drafts()[0].meta.b.frameUrl).toBe("/frames/for/woofx3:widget:image");
    await documents.submit("s1", "draft", 1, [x("b", 0, 9)]);
    expect(framePlacements).toHaveBeenCalledTimes(1);
  });

  it("copies a live edit into the draft field by field, keeping the draft's other edits", async () => {
    const { documents } = setup(scene([instance("a", { settings: { text: "hi" } })]));
    await documents.submit("s1", "draft", 0, [{ p: ["widgets", "a", "y"], od: 0, oi: 70 }]);
    await documents.submit("s1", "published", 0, [x("a", 0, 40)]);
    const draft = (await documents.snapshot("s1", "draft"))!.doc.widgets.a!;
    expect(draft.x).toBe(40);
    expect(draft.y).toBe(70);
    expect((await documents.snapshot("s1"))!.doc.widgets.a!.y).toBe(0);
  });

  it("publishes the draft as ops overlays apply, and discards it back to what is published", async () => {
    const { documents, published, writes } = setup(scene([instance("a")]));
    await documents.submit("s1", "draft", 0, [x("a", 0, 40)]);
    expect(await documents.publish("s1")).toBe(true);
    expect(published()).toHaveLength(1);
    expect(published()[0].ops).toEqual([x("a", 0, 40)]);
    expect(documents.hasDraft("s1")).toBe(false);
    expect(writes.at(-1)).toMatchObject({ id: "s1", clearDraft: true });
    expect(JSON.parse(writes.at(-1)!.widgetsJson!)[0].position).toEqual({ x: 40, y: 0 });

    await documents.submit("s1", "draft", 1, [x("a", 40, 99)]);
    await documents.discard("s1");
    expect((await documents.snapshot("s1", "draft"))!.doc.widgets.a!.x).toBe(40);
    expect(writes.at(-1)).toEqual({ id: "s1", clearDraft: true });
  });
});

describe("SceneDocuments — autosave", () => {
  it("writes a version back a moment after its last change, once", async () => {
    const { documents, writes } = setup(scene([instance("a")]));
    await documents.submit("s1", "draft", 0, [x("a", 0, 1)]);
    await documents.submit("s1", "draft", 1, [x("a", 1, 2)]);
    expect(writes).toEqual([]);
    await sleep(30);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ id: "s1", draftLayoutJson: "{}" });
    expect(JSON.parse(writes[0]!.draftWidgetsJson!)[0].position).toEqual({ x: 2, y: 0 });
  });

  it("does not take the database's echo of its own write for a save made elsewhere", async () => {
    const { documents, save, published } = setup(scene([instance("a")]));
    await documents.submit("s1", "published", 0, [x("a", 0, 40)]);
    await sleep(30);
    // The echo of that write: what was written, read back.
    save(scene([instance("a", { position: { x: 40, y: 0, width: 100, height: 50 } })]));
    await documents.refresh("s1");
    expect(published()).toHaveLength(1);
  });

  it("lets edits waiting to be written win over a save that lands first", async () => {
    const { documents, published } = setup(scene([instance("a")]));
    await documents.submit("s1", "published", 0, [x("a", 0, 40)]);
    await documents.refresh("s1");
    expect(published()).toHaveLength(1);
    expect((await documents.snapshot("s1"))!.doc.widgets.a!.x).toBe(40);
  });

  it("writes everything waiting when flushed", async () => {
    const { documents, writes } = setup(scene([instance("a")]));
    await documents.submit("s1", "published", 0, [x("a", 0, 40)]);
    await documents.flush();
    expect(writes.some((w) => w.widgetsJson !== undefined)).toBe(true);
  });
});

describe("documentOf + storedSceneOf", () => {
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
