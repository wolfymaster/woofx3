import { describe, expect, it, mock } from "bun:test";
import { applyOps } from "../../public/scene-manager/scene-document";
import { SCENE_OPS_EVENT, SceneDocuments } from "../../src/scene/scene-documents";
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

function setup(initial: OverlaySceneState) {
  let saved = initial;
  const loads = mock(async (_sceneId: string) => saved);
  const sent: Array<{ sceneId: string; event: string; data: any }> = [];
  let connected = ["s1"];
  const documents = new SceneDocuments(
    { loadFramedSceneById: loads },
    {
      broadcast: (sceneId, event, data) => sent.push({ sceneId, event, data }),
      connectedSceneIds: () => connected,
    },
    logger()
  );
  return {
    documents,
    loads,
    sent,
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

describe("SceneDocuments", () => {
  it("loads a scene once and starts it at seq 0", async () => {
    const { documents, loads } = setup(scene([instance("a")]));
    const first = await documents.snapshot("s1");
    await documents.snapshot("s1");
    expect(loads).toHaveBeenCalledTimes(1);
    expect(first!.seq).toBe(0);
    expect(first!.doc.widgets.a!.settings).toEqual({ text: "hi" });
    expect(first!.meta.a!.frameUrl).toBe("/frames/woofx3/text?v=1");
  });

  it("pushes a save as the ops for the next seq, which turn the old document into the new", async () => {
    const { documents, sent, save } = setup(scene([instance("a")]));
    const before = await documents.snapshot("s1");
    save(scene([instance("a", { settings: { text: "hi there" }, position: { x: 5, y: 0, width: 100, height: 50 } })]));
    await documents.refresh("s1");

    expect(sent).toHaveLength(1);
    expect(sent[0]!.event).toBe(SCENE_OPS_EVENT);
    expect(sent[0]!.data.seq).toBe(1);
    const after = await documents.snapshot("s1");
    expect(applyOps(before!.doc, sent[0]!.data.ops)).toEqual(after!.doc);
    expect(documents.seqOf("s1")).toBe(1);
  });

  it("sends the meta of placements whose frame changed, and null for one removed", async () => {
    const { documents, sent, save } = setup(scene([instance("a"), instance("b")]));
    await documents.snapshot("s1");
    save(scene([instance("a", { frameUrl: "/frames/woofx3/text?v=2" })]));
    await documents.refresh("s1");
    expect(sent[0]!.data.meta).toEqual({
      a: { moduleId: "woofx3", hostsSurface: "", frameUrl: "/frames/woofx3/text?v=2", linkedResources: {} },
      b: null,
    });
  });

  it("sends nothing for a save that changed nothing", async () => {
    const { documents, sent } = setup(scene([instance("a")]));
    await documents.snapshot("s1");
    await documents.refresh("s1");
    expect(sent).toEqual([]);
    expect(documents.seqOf("s1")).toBe(0);
  });

  it("numbers saves in the order they arrive", async () => {
    const { documents, sent, save } = setup(scene([instance("a")]));
    await documents.snapshot("s1");
    save(scene([instance("a", { settings: { text: "one" } })]));
    const first = documents.refresh("s1");
    save(scene([instance("a", { settings: { text: "two" } })]));
    await Promise.all([first, documents.refresh("s1")]);
    expect(sent.map((s) => s.data.seq)).toEqual([1]);
    // Both refreshes read the latest save; the second found nothing new.
    expect((await documents.snapshot("s1"))!.doc.widgets.a!.settings).toEqual({ text: "two" });
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
