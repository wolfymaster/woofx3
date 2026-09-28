import { describe, expect, it } from "bun:test";
import {
  answerObsCommand,
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
  items: {
    sourceName: string;
    sceneItemId: number;
    inputKind: string | null;
    sceneItemEnabled: boolean;
    isGroup?: boolean;
  }[];
}

/** A fake OBS that answers the requests the control handler makes, from a fixed set of scenes. */
function fakeObs(
  scenes: FakeScene[],
  programScene = scenes[0]?.name ?? "",
  groups: FakeScene[] = [],
  hangOn: string | null = null
) {
  const calls: { cmd: string; args: unknown }[] = [];
  const findScene = (name: unknown) => {
    const scene = scenes.find((s) => s.name === name);
    if (!scene) {
      throw new ObsNotFound(`No source was found by the name of \`${String(name)}\`.`);
    }
    return scene;
  };
  const findSceneOrGroup = (name: unknown) => {
    const group = groups.find((g) => g.name === name);
    return group ?? findScene(name);
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
        const item = findSceneOrGroup(args.sceneName).items.find((i) => i.sceneItemId === args.sceneItemId);
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
      case "GetGroupSceneItemList": {
        const group = groups.find((g) => g.name === args.sceneName);
        if (!group) {
          throw new ObsNotFound(`No source was found by the name of \`${String(args.sceneName)}\`.`);
        }
        return { sceneItems: group.items.map((i) => ({ ...i })) };
      }
      default:
        throw new Error(`fake OBS does not handle ${cmd}`);
    }
  };
  const client = {
    async request(cmd: string, args?: Record<string, unknown>) {
      calls.push({ cmd, args });
      if (cmd === hangOn) {
        return new Promise(() => {});
      }
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
    expect(reply).toEqual({ ok: false, error: "OBS is not connected (retrying)" });
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

  it("names a scene that does not exist when showing a source", async () => {
    const obs = fakeObs(scenes());
    const reply = await executeObsControlCommand(obs.client, {
      command: "set_source_visibility",
      sceneName: "BRB",
      sourceName: "Confetti",
      visible: true,
    });
    expect(reply).toEqual({ ok: false, error: 'scene "BRB" does not exist in OBS' });
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
    expect(reply).toEqual({
      ok: false,
      error: 'source "Confetti" is not in the current scene ("Raid") or any group in it',
    });
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
            { name: "Camera", sceneItemId: 1, inputKind: "v4l2_input", enabled: true, group: null },
            { name: "Confetti", sceneItemId: 2, inputKind: "browser_source", enabled: false, group: null },
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

function groupedScenes() {
  const main: FakeScene = {
    name: "Main",
    index: 0,
    items: [
      { sourceName: "Camera", sceneItemId: 1, inputKind: "v4l2_input", sceneItemEnabled: true },
      { sourceName: "Alerts", sceneItemId: 2, inputKind: null, sceneItemEnabled: true, isGroup: true },
    ],
  };
  const alerts: FakeScene = {
    name: "Alerts",
    index: -1,
    items: [{ sourceName: "Confetti", sceneItemId: 7, inputKind: "browser_source", sceneItemEnabled: false }],
  };
  return { main, alerts };
}

describe("sources inside groups", () => {
  it("shows a source that sits in a group, addressing the group", async () => {
    const { main, alerts } = groupedScenes();
    const obs = fakeObs([main], "Main", [alerts]);
    const reply = await executeObsControlCommand(obs.client, {
      command: "set_source_visibility",
      sourceName: "Confetti",
      visible: true,
    });
    expect(reply).toEqual({ ok: true });
    expect(alerts.items[0].sceneItemEnabled).toBe(true);
    expect(obs.calls.at(-1)).toEqual({
      cmd: "SetSceneItemEnabled",
      args: { sceneName: "Alerts", sceneItemId: 7, sceneItemEnabled: true },
    });
  });

  it("lists a group's sources after the group, marked with its name", async () => {
    const { main, alerts } = groupedScenes();
    const obs = fakeObs([main], "Main", [alerts]);
    const reply = await executeObsControlCommand(obs.client, { command: "list_scenes" });
    expect(reply).toEqual({
      ok: true,
      scenes: [
        {
          name: "Main",
          sources: [
            { name: "Camera", sceneItemId: 1, inputKind: "v4l2_input", enabled: true, group: null },
            { name: "Alerts", sceneItemId: 2, inputKind: null, enabled: true, group: null },
            { name: "Confetti", sceneItemId: 7, inputKind: "browser_source", enabled: false, group: "Alerts" },
          ],
        },
      ],
    });
  });

  it("leaves out a scene that vanished between the listing and reading its items", async () => {
    const obs = fakeObs(scenes());
    const client = {
      async request(cmd: string, args?: Record<string, unknown>) {
        if (cmd === "GetSceneItemList" && args?.sceneName === "Raid") {
          throw new ObsNotFound("gone");
        }
        return obs.client.request(cmd as never, args as never);
      },
    } as unknown as ObsControlClient;
    const reply = await executeObsControlCommand(client, { command: "list_scenes" });
    expect(reply.ok && reply.scenes?.map((scene) => scene.name)).toEqual(["Main"]);
  });
});

describe("timeouts", () => {
  it("answers with a readable reason and asks for the session to be recycled", async () => {
    const obs = fakeObs(scenes(), "Main", [], "SetCurrentProgramScene");
    let recycled = 0;
    const reply = await executeObsControlCommand(
      obs.client,
      { command: "switch_scene", sceneName: "Raid" },
      { timeoutMs: 20, onTimeout: () => recycled++ }
    );
    expect(reply).toEqual({ ok: false, error: "OBS did not answer within 0.02s; reconnecting to it" });
    expect(recycled).toBe(1);
  });

  it("does not recycle on an answered failure", async () => {
    const obs = fakeObs(scenes());
    let recycled = 0;
    await executeObsControlCommand(
      obs.client,
      { command: "switch_scene", sceneName: "BRB" },
      { timeoutMs: 1_000, onTimeout: () => recycled++ }
    );
    expect(recycled).toBe(0);
  });
});

describe("answerObsCommand", () => {
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

  function message(data: Uint8Array, reply?: string) {
    const responses: unknown[] = [];
    return {
      msg: {
        reply,
        data,
        respond(bytes: Uint8Array) {
          responses.push(JSON.parse(new TextDecoder().decode(bytes)));
          return true;
        },
      },
      responses,
    };
  }

  it("refuses a message with no reply subject before it reaches OBS", async () => {
    const obs = fakeObs(scenes());
    const { msg, responses } = message(encode({ data: { command: "switch_scene", sceneName: "Raid" } }));
    await answerObsCommand({ current: () => obs.client, recycle: () => {} }, msg, logger);
    expect(obs.calls).toEqual([]);
    expect(obs.program()).toBe("Main");
    expect(responses).toEqual([]);
  });

  it("answers a request on its reply subject", async () => {
    const obs = fakeObs(scenes());
    const { msg, responses } = message(encode({ data: { command: "switch_scene", sceneName: "Raid" } }), "_INBOX.1");
    await answerObsCommand({ current: () => obs.client, recycle: () => {} }, msg, logger);
    expect(responses).toEqual([{ ok: true }]);
    expect(obs.program()).toBe("Raid");
  });

  it("recycles the session when OBS hangs", async () => {
    const obs = fakeObs(scenes(), "Main", [], "SetInputMute");
    const reasons: string[] = [];
    const { msg } = message(
      encode({ data: { command: "set_input_mute", inputName: "Mic/Aux", muted: true } }),
      "_INBOX.2"
    );
    const original = setTimeout;
    // Shorten the command deadline without waiting 3.5s: fire any timer at once.
    globalThis.setTimeout = ((fn: () => void) => original(fn, 0)) as unknown as typeof setTimeout;
    try {
      await answerObsCommand({ current: () => obs.client, recycle: (reason) => reasons.push(reason) }, msg, logger);
    } finally {
      globalThis.setTimeout = original;
    }
    expect(reasons).toEqual(["an OBS request timed out"]);
  });
});
