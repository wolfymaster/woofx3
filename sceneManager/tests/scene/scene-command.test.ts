import { describe, expect, it, mock } from "bun:test";
import {
  answerSceneCommand,
  executeSceneControlCommand,
  parseSceneControlCommand,
} from "../../src/scene/scene-command";
import { type SceneWrite, SceneDocuments } from "../../src/scene/scene-documents";
import type { OverlaySceneState } from "../../src/scene/scene-host";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;
}

const SCENE: OverlaySceneState = {
  sceneId: "scene-1",
  name: "Main",
  layout: {},
  instances: [
    {
      id: "board-1",
      widgetCanonicalId: "woofx3:widget:hype_board",
      moduleId: "woofx3",
      manifestId: "hype_board",
      position: { x: 0, y: 0, width: 100, height: 50 },
      settings: {},
      visible: true,
      hostsSurface: "",
      frameUrl: "/frames/woofx3/hype_board?v=1",
      linkedResources: {},
      resolved: true,
    },
  ],
};

/** Real scene documents over a fake database: what a command does to a scene. */
function documents(
  load: (sceneId: string) => Promise<OverlaySceneState | null> = async (id) => (id === "scene-1" ? SCENE : null)
) {
  const sent: Array<{ event: string; data: any }> = [];
  const writes: SceneWrite[] = [];
  const docs = new SceneDocuments(
    { loadFramedSceneById: load, framePlacements: async () => [] },
    { broadcast: (_sceneId, event, data) => sent.push({ event, data }), connectedSceneIds: () => ["scene-1"] },
    fakeLogger(),
    {
      autosaveMs: 1,
      persister: {
        updateScene: async (write) => {
          writes.push(write);
        },
      },
    }
  );
  return { docs, sent, writes };
}

const hide = {
  command: "set_placement_visibility",
  sceneId: "scene-1",
  placementId: "board-1",
  visible: false,
} as const;

describe("parseSceneControlCommand", () => {
  it("accepts a visibility command", () => {
    expect(parseSceneControlCommand(hide)).toEqual({ ok: true, command: hide });
  });

  it("refuses a misspelled field rather than ignoring it", () => {
    expect(parseSceneControlCommand({ ...hide, visible: undefined, visibile: false }).ok).toBe(false);
  });

  it("refuses an empty placement id and a visibility given as text", () => {
    expect(parseSceneControlCommand({ ...hide, placementId: "" }).ok).toBe(false);
    expect(parseSceneControlCommand({ ...hide, visible: "false" }).ok).toBe(false);
  });
});

describe("executeSceneControlCommand", () => {
  it("hides the widget on the published scene, copies it into the draft, and saves it", async () => {
    const { docs, sent, writes } = documents();
    expect(await executeSceneControlCommand(docs, hide)).toEqual({ ok: true });

    expect((await docs.snapshot("scene-1"))!.doc.widgets["board-1"]!.visible).toBe(false);
    expect((await docs.snapshot("scene-1", "draft"))!.doc.widgets["board-1"]!.visible).toBe(false);
    expect(sent.find((s) => s.data.version === "published")!.data.ops).toEqual([
      { p: ["widgets", "board-1", "visible"], od: true, oi: false },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const saved = writes.find((w) => w.widgetsJson !== undefined)!;
    expect(JSON.parse(saved.widgetsJson!)[0].visible).toBe(false);
  });

  it("changes nothing for a widget already that way", async () => {
    const { docs, sent } = documents();
    expect(await executeSceneControlCommand(docs, { ...hide, visible: true })).toEqual({ ok: true });
    expect(sent).toEqual([]);
  });

  it("names a scene that does not exist", async () => {
    const { docs } = documents();
    expect(await executeSceneControlCommand(docs, { ...hide, sceneId: "gone" })).toEqual({
      ok: false,
      error: 'scene "gone" does not exist',
    });
  });

  it("names a placement that is not on the scene", async () => {
    const { docs, sent } = documents();
    expect(await executeSceneControlCommand(docs, { ...hide, placementId: "removed-1" })).toEqual({
      ok: false,
      error: 'widget placement "removed-1" is not on scene "Main"',
    });
    expect(sent).toEqual([]);
  });
});

describe("answerSceneCommand", () => {
  function message(data: unknown, reply: string | undefined) {
    const respond = mock((_: Uint8Array) => true);
    return { reply, data: new TextEncoder().encode(JSON.stringify(data)), respond };
  }

  function replyOf(msg: ReturnType<typeof message>): unknown {
    return JSON.parse(new TextDecoder().decode(msg.respond.mock.calls[0]![0]));
  }

  it("answers a request with the outcome", async () => {
    const msg = message({ specversion: "1.0", type: "engine.scene.command", data: hide }, "_INBOX.1");
    await answerSceneCommand(documents().docs, msg, fakeLogger());
    expect(replyOf(msg)).toEqual({ ok: true });
  });

  it("answers a malformed command with why", async () => {
    const msg = message({ data: { command: "set_placement_visibility" } }, "_INBOX.1");
    await answerSceneCommand(documents().docs, msg, fakeLogger());
    expect((replyOf(msg) as { ok: boolean }).ok).toBe(false);
  });

  it("changes nothing for a bare publish, which only something other than the engine sends", async () => {
    const { docs, sent } = documents();
    const msg = message({ data: hide }, undefined);
    await answerSceneCommand(docs, msg, fakeLogger());
    expect(msg.respond).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("answers rather than throws when loading the scene fails", async () => {
    const { docs } = documents(async () => Promise.reject(new Error("db down")));
    const msg = message({ data: hide }, "_INBOX.1");
    await answerSceneCommand(docs, msg, fakeLogger());
    expect(replyOf(msg)).toEqual({ ok: false, error: "scene manager error: db down" });
  });
});
