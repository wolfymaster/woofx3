import { describe, expect, it } from "bun:test";
import {
  executeObsControlCommand,
  handleObsControlRequest,
  type ObsControlClient,
  parseObsControlCommand,
} from "../../src/obs/control";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Parameters<typeof handleObsControlRequest>[2];

class ObsNotFound extends Error {
  code = 600;
}

interface FakeScene {
  name: string;
  index: number;
  items: { sourceName: string; sceneItemId: number; inputKind: string | null; sceneItemEnabled: boolean }[];
}

/** A fake OBS that answers the requests the control handler makes, from a fixed set of scenes. */
function fakeObs(scenes: FakeScene[], programScene = scenes[0]?.name ?? "") {
  const calls: { cmd: string; args: unknown }[] = [];
  const findScene = (name: unknown) => {
    const scene = scenes.find((s) => s.name === name);
    if (!scene) {
      throw new ObsNotFound(`No source was found by the name of \`${String(name)}\`.`);
    }
    return scene;
  };
  const answer = (cmd: string, args: Record<string, unknown>): unknown => {
    switch (cmd) {
      case "SetCurrentProgramScene":
        findScene(args.sceneName);
        programScene = String(args.sceneName);
        return {};
      case "GetCurrentProgramScene":
        return { sceneName: programScene, currentProgramSceneName: programScene, sceneUuid: "" };
      case "GetSceneItemId": {
        const item = findScene(args.sceneName).items.find((i) => i.sourceName === args.sourceName);
        if (!item) {
          throw new ObsNotFound(`No scene items were found in the specified scene by that criteria.`);
        }
        return { sceneItemId: item.sceneItemId };
      }
      case "SetSceneItemEnabled": {
        const item = findScene(args.sceneName).items.find((i) => i.sceneItemId === args.sceneItemId);
        if (!item) {
          throw new ObsNotFound("No scene item found.");
        }
        item.sceneItemEnabled = args.sceneItemEnabled === true;
        return {};
      }
      case "SetInputMute":
        if (args.inputName !== "Mic/Aux") {
          throw new ObsNotFound(`No source was found by the name of \`${String(args.inputName)}\`.`);
        }
        return {};
      case "GetSceneList":
        return {
          scenes: scenes.map((s) => ({ sceneName: s.name, sceneIndex: s.index })),
          currentProgramSceneName: programScene,
        };
      case "GetSceneItemList":
        return { sceneItems: findScene(args.sceneName).items.map((i) => ({ ...i })) };
      default:
        throw new Error(`fake OBS does not handle ${cmd}`);
    }
  };
  const client = {
    async request(cmd: string, args?: Record<string, unknown>) {
      calls.push({ cmd, args });
      return answer(cmd, args ?? {});
    },
  } as unknown as ObsControlClient;
  return { client, calls, program: () => programScene };
}

function scenes(): FakeScene[] {
  return [
    {
      name: "Main",
      index: 0,
      items: [
        { sourceName: "Camera", sceneItemId: 1, inputKind: "v4l2_input", sceneItemEnabled: true },
        { sourceName: "Confetti", sceneItemId: 2, inputKind: "browser_source", sceneItemEnabled: false },
      ],
    },
    { name: "Raid", index: 1, items: [] },
  ];
}

describe("parseObsControlCommand", () => {
  it("accepts each command in its documented shape", () => {
    for (const data of [
      { command: "switch_scene", sceneName: "Raid" },
      { command: "set_source_visibility", sourceName: "Confetti", visible: true },
      { command: "set_source_visibility", sceneName: "Main", sourceName: "Confetti", visible: false },
      { command: "set_input_mute", inputName: "Mic/Aux", muted: true },
      { command: "list_scenes" },
    ]) {
      expect(parseObsControlCommand(data)).toEqual({ ok: true, command: data as never });
    }
  });

  it("refuses a missing required field, naming it", () => {
    const parsed = parseObsControlCommand({ command: "switch_scene", sceneName: "" });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.error).toContain("sceneName");
  });

  it("refuses a visibility command that does not say which way", () => {
    const parsed = parseObsControlCommand({ command: "set_source_visibility", sourceName: "Confetti" });
    expect(parsed.ok ? "" : parsed.error).toContain("visible");
  });

  it("refuses a misspelled field rather than ignoring it", () => {
    const parsed = parseObsControlCommand({
      command: "set_source_visibility",
      sourceName: "Confetti",
      visible: true,
      visibile: false,
    });
    expect(parsed.ok).toBe(false);
  });

  it("refuses an unknown command and a missing payload", () => {
    expect(parseObsControlCommand({ command: "start_stream" }).ok).toBe(false);
    expect(parseObsControlCommand(undefined).ok).toBe(false);
  });
});

describe("executeObsControlCommand", () => {
  it("answers not connected when there is no OBS connection", async () => {
    const reply = await executeObsControlCommand(null, { command: "switch_scene", sceneName: "Raid" });
    expect(reply).toEqual({ ok: false, error: "OBS is not connected to the scene manager" });
  });

  it("switches the program scene", async () => {
    const obs = fakeObs(scenes());
    const reply = await executeObsControlCommand(obs.client, { command: "switch_scene", sceneName: "Raid" });
    expect(reply).toEqual({ ok: true });
    expect(obs.program()).toBe("Raid");
  });

  it("names a scene OBS does not have", async () => {
    const obs = fakeObs(scenes());
    const reply = await executeObsControlCommand(obs.client, { command: "switch_scene", sceneName: "BRB" });
    expect(reply).toEqual({ ok: false, error: 'scene "BRB" does not exist in OBS' });
  });

  it("shows a source in the named scene", async () => {
    const all = scenes();
    const obs = fakeObs(all, "Raid");
    const reply = await executeObsControlCommand(obs.client, {
      command: "set_source_visibility",
      sceneName: "Main",
      sourceName: "Confetti",
      visible: true,
    });
    expect(reply).toEqual({ ok: true });
    expect(all[0].items[1].sceneItemEnabled).toBe(true);
    expect(obs.calls.map((c) => c.cmd)).not.toContain("GetCurrentProgramScene");
  });

  it("hides a source in the current program scene when no scene is named", async () => {
    const all = scenes();
    const obs = fakeObs(all, "Main");
    const reply = await executeObsControlCommand(obs.client, {
      command: "set_source_visibility",
      sourceName: "Camera",
      visible: false,
    });
    expect(reply).toEqual({ ok: true });
    expect(all[0].items[0].sceneItemEnabled).toBe(false);
  });

  it("names a source that is not in the scene", async () => {
    const obs = fakeObs(scenes(), "Raid");
    const reply = await executeObsControlCommand(obs.client, {
      command: "set_source_visibility",
      sourceName: "Confetti",
      visible: true,
    });
    expect(reply).toEqual({ ok: false, error: 'source "Confetti" is not in the current scene' });
  });

  it("mutes an input, and names one that does not exist", async () => {
    const obs = fakeObs(scenes());
    expect(
      await executeObsControlCommand(obs.client, { command: "set_input_mute", inputName: "Mic/Aux", muted: true })
    ).toEqual({
      ok: true,
    });
    expect(obs.calls.at(-1)).toEqual({ cmd: "SetInputMute", args: { inputName: "Mic/Aux", inputMuted: true } });
    expect(
      await executeObsControlCommand(obs.client, { command: "set_input_mute", inputName: "Desk", muted: false })
    ).toEqual({
      ok: false,
      error: 'input "Desk" does not exist in OBS',
    });
  });

  it("passes on any other OBS refusal with its own message", async () => {
    const client = {
      async request() {
        throw new Error("Not connected");
      },
    } as unknown as ObsControlClient;
    const reply = await executeObsControlCommand(client, { command: "switch_scene", sceneName: "Raid" });
    expect(reply).toEqual({ ok: false, error: "OBS refused switch_scene: Not connected" });
  });

  it("lists scenes top first, with their sources", async () => {
    const obs = fakeObs(scenes());
    const reply = await executeObsControlCommand(obs.client, { command: "list_scenes" });
    expect(reply).toEqual({
      ok: true,
      scenes: [
        { name: "Raid", sources: [] },
        {
          name: "Main",
          sources: [
            { name: "Camera", sceneItemId: 1, inputKind: "v4l2_input", enabled: true },
            { name: "Confetti", sceneItemId: 2, inputKind: "browser_source", enabled: false },
          ],
        },
      ],
    });
  });
});

describe("handleObsControlRequest", () => {
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

  it("runs the command carried in the CloudEvent's data", async () => {
    const obs = fakeObs(scenes());
    const reply = await handleObsControlRequest(
      obs.client,
      encode({ specversion: "1.0", type: "engine.obs.command", data: { command: "switch_scene", sceneName: "Raid" } }),
      logger
    );
    expect(reply).toEqual({ ok: true });
    expect(obs.program()).toBe("Raid");
  });

  it("answers a malformed payload instead of throwing", async () => {
    const reply = await handleObsControlRequest(null, new TextEncoder().encode("{not json"), logger);
    expect(reply.ok).toBe(false);
  });

  it("refuses an invalid command before touching OBS", async () => {
    const obs = fakeObs(scenes());
    const reply = await handleObsControlRequest(obs.client, encode({ data: { command: "switch_scene" } }), logger);
    expect(reply.ok).toBe(false);
    expect(obs.calls).toEqual([]);
  });
});
