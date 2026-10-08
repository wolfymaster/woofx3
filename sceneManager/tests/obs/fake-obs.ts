// A fake obs-websocket client for the scene manager's OBS handler tests.

import type { Logger } from "@woofx3/common/runtime";
import type { ObsControlClient } from "../../src/obs/control";

export const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

export class ObsNotFound extends Error {
  code = 600;
}

export class ObsAlreadyExists extends Error {
  code = 601;
}

export interface FakeInput {
  inputName: string;
  inputKind: string;
  unversionedInputKind: string;
  inputSettings?: Record<string, unknown>;
}

export interface FakeScene {
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
export function fakeObs(
  scenes: FakeScene[],
  programScene = scenes[0]?.name ?? "",
  groups: FakeScene[] = [],
  hangOn: string | null = null,
  inputs: FakeInput[] = []
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
  const findInput = (name: unknown) => {
    const input = inputs.find((i) => i.inputName === name);
    if (!input) {
      throw new ObsNotFound(`No source was found by the name of \`${String(name)}\`.`);
    }
    return input;
  };
  // OBS creates a scene item enabled unless told otherwise.
  const addItem = (scene: FakeScene, sourceName: string, inputKind: string, enabled: unknown) => {
    const sceneItemId = Math.max(0, ...scene.items.map((i) => i.sceneItemId)) + 1;
    scene.items.push({ sourceName, sceneItemId, inputKind, sceneItemEnabled: enabled !== false });
    return sceneItemId;
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
      case "GetInputList":
        return { inputs: inputs.map(({ inputSettings: _, ...i }) => ({ ...i })) };
      case "GetInputSettings": {
        const input = findInput(args.inputName);
        return { inputKind: input.inputKind, inputSettings: { ...input.inputSettings } };
      }
      case "SetInputSettings": {
        const input = findInput(args.inputName);
        const settings = args.inputSettings as Record<string, unknown>;
        input.inputSettings = args.overlay === false ? { ...settings } : { ...input.inputSettings, ...settings };
        return {};
      }
      case "CreateInput": {
        const scene = findScene(args.sceneName);
        if (inputs.some((i) => i.inputName === args.inputName)) {
          throw new ObsAlreadyExists("A source already exists by that input name.");
        }
        const inputKind = String(args.inputKind);
        inputs.push({
          inputName: String(args.inputName),
          inputKind,
          unversionedInputKind: inputKind,
          inputSettings: { ...(args.inputSettings as Record<string, unknown>) },
        });
        return { inputUuid: "", sceneItemId: addItem(scene, String(args.inputName), inputKind, args.sceneItemEnabled) };
      }
      case "CreateSceneItem": {
        const scene = findScene(args.sceneName);
        const input = findInput(args.sourceName);
        return { sceneItemId: addItem(scene, input.inputName, input.inputKind, args.sceneItemEnabled) };
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

export function scenes(): FakeScene[] {
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

export function groupedScenes() {
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
