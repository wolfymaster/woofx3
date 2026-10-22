import { describe, expect, it } from "bun:test";
import type { ObsControlClient } from "../../src/obs/control";
import { answerObsOptions, executeObsOptionsRequest, handleObsOptionsRequest } from "../../src/obs/options";
import { fakeObs, groupedScenes, logger, ObsNotFound, scenes } from "./fake-obs";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("executeObsOptionsRequest", () => {
  it("answers not connected, as a field-options error, when there is no OBS connection", async () => {
    expect(await executeObsOptionsRequest(null, "scenes")).toEqual({ error: "OBS is not connected (retrying)" });
  });

  it("lists scenes top of OBS's list first, as options", async () => {
    const obs = fakeObs(scenes());
    expect(await executeObsOptionsRequest(obs.client, "scenes")).toEqual([
      { value: "Raid", label: "Raid" },
      { value: "Main", label: "Main" },
    ]);
  });

  it("lists sources headed by their scene, a group's sources labelled with the group", async () => {
    const { main, alerts } = groupedScenes();
    const obs = fakeObs([main], "Main", [alerts]);
    expect(await executeObsOptionsRequest(obs.client, "sources")).toEqual([
      { value: "Camera", label: "Camera", group: "Main" },
      { value: "Alerts", label: "Alerts", group: "Main" },
      { value: "Confetti", label: "Alerts › Confetti", group: "Main" },
    ]);
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
    const reply = await executeObsOptionsRequest(client, "sources");
    expect(Array.isArray(reply) && reply.map((option) => option.group)).toEqual(["Main", "Main"]);
  });

  it("lists every input, audio-only kinds first, global audio devices included", async () => {
    const obs = fakeObs(scenes(), "Main", [], null, [
      { inputName: "Confetti", inputKind: "browser_source", unversionedInputKind: "browser_source" },
      { inputName: "Mic/Aux", inputKind: "wasapi_input_capture", unversionedInputKind: "wasapi_input_capture" },
      { inputName: "Desktop Audio", inputKind: "pulse_output_capture", unversionedInputKind: "pulse_output_capture" },
    ]);
    expect(await executeObsOptionsRequest(obs.client, "inputs")).toEqual([
      { value: "Mic/Aux", label: "Mic/Aux", group: "Audio inputs" },
      { value: "Desktop Audio", label: "Desktop Audio", group: "Audio inputs" },
      { value: "Confetti", label: "Confetti", group: "Other inputs" },
    ]);
  });

  it("answers a hung OBS with a reason and asks for the session to be recycled", async () => {
    const obs = fakeObs(scenes(), "Main", [], "GetSceneList");
    let recycled = 0;
    const reply = await executeObsOptionsRequest(obs.client, "scenes", { timeoutMs: 20, onTimeout: () => recycled++ });
    expect(reply).toEqual({ error: "OBS did not answer within 0.02s; reconnecting to it" });
    expect(recycled).toBe(1);
  });
});

describe("handleObsOptionsRequest", () => {
  it("lists what the CloudEvent's data asks for", async () => {
    const obs = fakeObs(scenes());
    const reply = await handleObsOptionsRequest(obs.client, encode({ data: { list: "scenes" } }), logger);
    expect(reply).toEqual([
      { value: "Raid", label: "Raid" },
      { value: "Main", label: "Main" },
    ]);
  });

  it("refuses anything but a listing before touching OBS", async () => {
    const obs = fakeObs(scenes());
    for (const data of [
      { list: "filters" },
      { command: "switch_scene", sceneName: "Raid" },
      { list: "scenes", command: "switch_scene" },
      undefined,
    ]) {
      const reply = await handleObsOptionsRequest(obs.client, encode({ data }), logger);
      expect(Array.isArray(reply)).toBe(false);
    }
    expect(obs.calls).toEqual([]);
    expect(obs.program()).toBe("Main");
  });

  it("answers a malformed payload instead of throwing", async () => {
    const reply = await handleObsOptionsRequest(null, new TextEncoder().encode("{not json"), logger);
    expect(reply).toEqual({ error: "invalid OBS options request: payload is not JSON" });
  });
});

describe("answerObsOptions", () => {
  const session = (client: ObsControlClient | null) => ({ current: () => client, recycle: () => {} });

  it("responds with the listing as JSON", async () => {
    const obs = fakeObs(scenes());
    const responses: unknown[] = [];
    await answerObsOptions(
      session(obs.client),
      {
        reply: "_INBOX.1",
        data: encode({ data: { list: "scenes" } }),
        respond: (data) => {
          responses.push(JSON.parse(new TextDecoder().decode(data)));
          return true;
        },
      },
      logger
    );
    expect(responses).toEqual([
      [
        { value: "Raid", label: "Raid" },
        { value: "Main", label: "Main" },
      ],
    ]);
  });

  it("ignores a message with no reply subject", async () => {
    const obs = fakeObs(scenes());
    let responded = false;
    await answerObsOptions(
      session(obs.client),
      {
        data: encode({ data: { list: "scenes" } }),
        respond: () => {
          responded = true;
          return true;
        },
      },
      logger
    );
    expect(responded).toBe(false);
    expect(obs.calls).toEqual([]);
  });
});
