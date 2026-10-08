import { describe, expect, it } from "bun:test";
import {
  answerObsCommand,
  executeObsControlCommand,
  handleObsControlRequest,
  type ObsControlClient,
  parseObsControlCommand,
} from "../../src/obs/control";
import { type FakeInput, fakeObs, groupedScenes, logger, scenes } from "./fake-obs";

describe("parseObsControlCommand", () => {
  it("accepts each command in its documented shape", () => {
    for (const data of [
      { command: "switch_scene", sceneName: "Raid" },
      { command: "set_source_visibility", sourceName: "Confetti", visible: true },
      { command: "set_source_visibility", sceneName: "Main", sourceName: "Confetti", visible: false },
      { command: "set_input_mute", inputName: "Mic/Aux", muted: true },
      {
        command: "show_browser_source",
        sourceName: "Winner",
        url: "https://player.twitch.tv/?channel=wolfy",
        width: 1920,
        height: 1080,
      },
      {
        command: "show_browser_source",
        sceneName: "Main",
        sourceName: "Winner",
        url: "http://localhost:8080/",
        width: 1280,
        height: 720,
      },
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

  it("refuses a browser source page that is not an http(s) URL, and a size out of range", () => {
    const base = { command: "show_browser_source", sourceName: "Winner", width: 1920, height: 1080 };
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "ftp://example.com", "example.com", ""]) {
      const parsed = parseObsControlCommand({ ...base, url });
      expect(parsed.ok ? "" : parsed.error).toContain("url");
    }
    for (const size of [{ width: 0 }, { width: 1920.5 }, { width: 7681 }, { height: 4321 }]) {
      expect(parseObsControlCommand({ ...base, url: "https://example.com", ...size }).ok).toBe(false);
    }
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
});

describe("show_browser_source", () => {
  const show = (overrides: Partial<{ sceneName: string; sourceName: string; url: string }> = {}) =>
    ({
      command: "show_browser_source",
      sourceName: "Winner",
      url: "https://player.twitch.tv/?channel=wolfy",
      width: 1280,
      height: 720,
      ...overrides,
    }) as const;
  const browser = (inputName: string, inputSettings: Record<string, unknown>) => ({
    inputName,
    inputKind: "browser_source",
    unversionedInputKind: "browser_source",
    inputSettings,
  });

  it("creates the source in the current program scene when OBS has none by that name", async () => {
    const all = scenes();
    const inputs: FakeInput[] = [];
    const obs = fakeObs(all, "Raid", [], null, inputs);
    const reply = await executeObsControlCommand(obs.client, show());
    expect(reply).toEqual({ ok: true });
    expect(obs.calls.at(-1)).toEqual({
      cmd: "CreateInput",
      args: {
        sceneName: "Raid",
        inputName: "Winner",
        inputKind: "browser_source",
        inputSettings: { url: "https://player.twitch.tv/?channel=wolfy", width: 1280, height: 720 },
        sceneItemEnabled: true,
      },
    });
    expect(all[1].items).toEqual([
      { sourceName: "Winner", sceneItemId: 1, inputKind: "browser_source", sceneItemEnabled: true },
    ]);
  });

  it("points an existing browser source at the page, keeping its other settings, and shows it", async () => {
    const all = scenes();
    const inputs = [browser("Confetti", { url: "https://old.example", width: 800, height: 600, css: "x" })];
    const obs = fakeObs(all, "Raid", [], null, inputs);
    const reply = await executeObsControlCommand(
      obs.client,
      show({ sceneName: "Main", sourceName: "Confetti", url: "https://new.example/" })
    );
    expect(reply).toEqual({ ok: true });
    expect(inputs[0].inputSettings).toEqual({ url: "https://new.example/", width: 800, height: 600, css: "x" });
    expect(all[0].items[1].sceneItemEnabled).toBe(true);
    expect(obs.calls.map((c) => c.cmd)).toEqual([
      "GetInputSettings",
      "GetSceneItemList",
      "SetInputSettings",
      "SetSceneItemEnabled",
    ]);
  });

  it("shows an existing browser source inside a group of the scene, addressing the group", async () => {
    const { main, alerts } = groupedScenes();
    const inputs = [browser("Confetti", { url: "https://old.example" })];
    const obs = fakeObs([main], "Main", [alerts], null, inputs);
    const reply = await executeObsControlCommand(obs.client, show({ sourceName: "Confetti" }));
    expect(reply).toEqual({ ok: true });
    expect(alerts.items[0].sceneItemEnabled).toBe(true);
    expect(main.items.map((i) => i.sourceName)).toEqual(["Camera", "Alerts"]);
  });

  it("adds an existing browser source to a scene it is not in yet", async () => {
    const all = scenes();
    const inputs = [browser("Confetti", { url: "https://old.example" })];
    const obs = fakeObs(all, "Main", [], null, inputs);
    const reply = await executeObsControlCommand(obs.client, show({ sceneName: "Raid", sourceName: "Confetti" }));
    expect(reply).toEqual({ ok: true });
    expect(obs.calls.at(-1)).toEqual({
      cmd: "CreateSceneItem",
      args: { sceneName: "Raid", sourceName: "Confetti", sceneItemEnabled: true },
    });
    expect(all[1].items).toEqual([
      { sourceName: "Confetti", sceneItemId: 1, inputKind: "browser_source", sceneItemEnabled: true },
    ]);
    expect(inputs[0].inputSettings).toEqual({ url: "https://player.twitch.tv/?channel=wolfy" });
  });

  it("refuses to replace a source of another kind, changing nothing", async () => {
    const inputs: FakeInput[] = [
      { inputName: "Camera", inputKind: "v4l2_input", unversionedInputKind: "v4l2_input", inputSettings: {} },
    ];
    const obs = fakeObs(scenes(), "Main", [], null, inputs);
    const reply = await executeObsControlCommand(obs.client, show({ sourceName: "Camera" }));
    expect(reply).toEqual({
      ok: false,
      error:
        'source "Camera" in OBS is not a browser source (it is a "v4l2_input"); use another name so it is not replaced',
    });
    expect(obs.calls.map((c) => c.cmd)).toEqual(["GetCurrentProgramScene", "GetInputSettings"]);
    expect(inputs[0].inputSettings).toEqual({});
  });

  it("names a scene that does not exist, whether creating or reusing the source", async () => {
    const created = fakeObs(scenes(), "Main", [], null, []);
    expect(await executeObsControlCommand(created.client, show({ sceneName: "BRB" }))).toEqual({
      ok: false,
      error: 'scene "BRB" does not exist in OBS',
    });

    const inputs = [browser("Winner", { url: "https://old.example" })];
    const reused = fakeObs(scenes(), "Main", [], null, inputs);
    expect(await executeObsControlCommand(reused.client, show({ sceneName: "BRB" }))).toEqual({
      ok: false,
      error: 'scene "BRB" does not exist in OBS',
    });
    expect(inputs[0].inputSettings).toEqual({ url: "https://old.example" });
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
