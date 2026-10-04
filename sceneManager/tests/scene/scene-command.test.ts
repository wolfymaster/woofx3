import { describe, expect, it, mock } from "bun:test";
import { PlacementVisibility } from "../../src/scene/placement-visibility";
import {
  answerSceneCommand,
  executeSceneControlCommand,
  PLACEMENT_VISIBILITY_FRAME,
  parseSceneControlCommand,
  type SceneCommandDeps,
} from "../../src/scene/scene-command";
import type { OverlaySceneState } from "../../src/scene/scene-host";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
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
      hostsSurface: "",
      frameUrl: "/scene/scene-1/widget/board-1",
      resolved: true,
      hidden: true,
      visible: false,
    },
  ],
};

function deps(): SceneCommandDeps & { broadcast: ReturnType<typeof mock> } {
  return {
    loadSceneById: async (sceneId) => (sceneId === "scene-1" ? SCENE : null),
    visibility: new PlacementVisibility(),
    broadcast: mock(() => {}),
  };
}

const show = {
  command: "set_placement_visibility",
  sceneId: "scene-1",
  placementId: "board-1",
  visible: true,
} as const;

describe("parseSceneControlCommand", () => {
  it("accepts a visibility command", () => {
    expect(parseSceneControlCommand(show)).toEqual({ ok: true, command: show });
  });

  it("refuses a misspelled field rather than ignoring it", () => {
    const parsed = parseSceneControlCommand({ ...show, visible: undefined, visibile: false });
    expect(parsed.ok).toBe(false);
  });

  it("refuses an empty placement id and a visibility given as text", () => {
    expect(parseSceneControlCommand({ ...show, placementId: "" }).ok).toBe(false);
    expect(parseSceneControlCommand({ ...show, visible: "true" }).ok).toBe(false);
  });
});

describe("executeSceneControlCommand", () => {
  it("records the change and pushes it to the scene's overlays", async () => {
    const d = deps();
    expect(await executeSceneControlCommand(d, show)).toEqual({ ok: true });
    expect(d.visibility.visibleOf("scene-1", SCENE.instances[0])).toBe(true);
    expect(d.broadcast).toHaveBeenCalledWith("scene-1", PLACEMENT_VISIBILITY_FRAME, {
      instanceId: "board-1",
      visible: true,
    });
  });

  it("names a scene that does not exist", async () => {
    const d = deps();
    const reply = await executeSceneControlCommand(d, { ...show, sceneId: "gone" });
    expect(reply).toEqual({ ok: false, error: 'scene "gone" does not exist' });
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("names a placement that is not on the scene", async () => {
    const d = deps();
    const reply = await executeSceneControlCommand(d, { ...show, placementId: "removed-1" });
    expect(reply).toEqual({ ok: false, error: 'widget placement "removed-1" is not on scene "Main"' });
    expect(d.broadcast).not.toHaveBeenCalled();
  });
});

describe("answerSceneCommand", () => {
  function message(data: unknown, reply: string | undefined) {
    const respond = mock((_: Uint8Array) => true);
    return { reply, data: new TextEncoder().encode(JSON.stringify(data)), respond };
  }

  function replyOf(msg: ReturnType<typeof message>): unknown {
    return JSON.parse(new TextDecoder().decode(msg.respond.mock.calls[0][0]));
  }

  it("answers a request with the outcome", async () => {
    const msg = message({ specversion: "1.0", type: "engine.scene.command", data: show }, "_INBOX.1");
    await answerSceneCommand(deps(), msg, fakeLogger());
    expect(replyOf(msg)).toEqual({ ok: true });
  });

  it("answers a malformed command with why", async () => {
    const msg = message({ data: { command: "set_placement_visibility" } }, "_INBOX.1");
    await answerSceneCommand(deps(), msg, fakeLogger());
    expect((replyOf(msg) as { ok: boolean }).ok).toBe(false);
  });

  it("changes nothing for a bare publish, which only something other than the engine sends", async () => {
    const d = deps();
    const msg = message({ data: show }, undefined);
    await answerSceneCommand(d, msg, fakeLogger());
    expect(msg.respond).not.toHaveBeenCalled();
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("answers rather than throws when loading the scene fails", async () => {
    const d = { ...deps(), loadSceneById: async () => Promise.reject(new Error("db down")) };
    const msg = message({ data: show }, "_INBOX.1");
    await answerSceneCommand(d, msg, fakeLogger());
    expect(replyOf(msg)).toEqual({ ok: false, error: "scene manager error: db down" });
  });
});
