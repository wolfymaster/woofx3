import { describe, expect, it } from "bun:test";
import { isOverlayUrl, refreshOverlayBrowserSources, type ObsRequester } from "../../src/obs/refresh-overlays";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Parameters<typeof refreshOverlayBrowserSources>[2];

describe("isOverlayUrl", () => {
  it("matches an overlay URL on our port regardless of host spelling", () => {
    // Host is deliberately not part of the match: the bind host is
    // routinely 0.0.0.0 while OBS holds whatever the user typed.
    for (const host of ["localhost", "127.0.0.1", "studio-pc.local"]) {
      expect(isOverlayUrl(`http://${host}:9101/scene/abc?token=t`, 9101)).toBe(true);
    }
  });

  it("rejects a browser source on a different port", () => {
    expect(isOverlayUrl("http://localhost:9102/scene/abc", 9101)).toBe(false);
  });

  it("rejects a non-scene path on our port", () => {
    expect(isOverlayUrl("http://localhost:9101/assets/vendor/datastar.js", 9101)).toBe(false);
  });

  it("resolves the implicit port for http and https", () => {
    expect(isOverlayUrl("http://overlay.local/scene/abc", 80)).toBe(true);
    expect(isOverlayUrl("https://overlay.local/scene/abc", 443)).toBe(true);
    expect(isOverlayUrl("https://overlay.local/scene/abc", 80)).toBe(false);
  });

  it("rejects unset and unparseable values", () => {
    expect(isOverlayUrl(undefined, 9101)).toBe(false);
    expect(isOverlayUrl("", 9101)).toBe(false);
    expect(isOverlayUrl("not a url", 9101)).toBe(false);
    expect(isOverlayUrl(42, 9101)).toBe(false);
  });
});

interface FakeInput {
  inputName: string;
  inputKind: string;
  url?: string;
  settingsThrows?: boolean;
  pressThrows?: boolean;
}

function fakeObs(inputs: FakeInput[], opts: { listThrows?: boolean } = {}) {
  const pressed: string[] = [];
  const obs = {
    request: (async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "GetInputList") {
        if (opts.listThrows) {
          throw new Error("obs down");
        }
        return { inputs: inputs.map((i) => ({ inputName: i.inputName, inputKind: i.inputKind })) };
      }
      if (cmd === "GetInputSettings") {
        const input = inputs.find((i) => i.inputName === args.inputName);
        if (input?.settingsThrows) {
          throw new Error("input vanished");
        }
        return { inputSettings: { url: input?.url } };
      }
      if (cmd === "PressInputPropertiesButton") {
        const input = inputs.find((i) => i.inputName === args.inputName);
        if (input?.pressThrows) {
          throw new Error("refused");
        }
        pressed.push(`${String(args.inputName)}:${String(args.propertyName)}`);
        return {};
      }
      throw new Error(`unexpected command ${cmd}`);
    }) as unknown as ObsRequester["request"],
  } as ObsRequester;
  return { obs, pressed };
}

describe("refreshOverlayBrowserSources", () => {
  it("refreshes only the browser sources pointed at this sceneManager", async () => {
    const { obs, pressed } = fakeObs([
      { inputName: "Overlay", inputKind: "browser_source", url: "http://localhost:9101/scene/abc?token=t" },
      { inputName: "Chat", inputKind: "browser_source", url: "https://twitch.tv/popout/x/chat" },
      { inputName: "Webcam", inputKind: "v4l2_input" },
    ]);
    expect(await refreshOverlayBrowserSources(obs, 9101, logger)).toBe(1);
    expect(pressed).toEqual(["Overlay:refreshnocache"]);
  });

  it("is a no-op when OBS is not connected", async () => {
    expect(await refreshOverlayBrowserSources(null, 9101, logger)).toBe(0);
  });

  it("returns zero rather than throwing when the input list is unavailable", async () => {
    const { obs } = fakeObs([], { listThrows: true });
    expect(await refreshOverlayBrowserSources(obs, 9101, logger)).toBe(0);
  });

  it("skips an input whose settings cannot be read and still refreshes the rest", async () => {
    const { obs, pressed } = fakeObs([
      { inputName: "Gone", inputKind: "browser_source", settingsThrows: true },
      { inputName: "Overlay", inputKind: "browser_source", url: "http://127.0.0.1:9101/scene/abc" },
    ]);
    expect(await refreshOverlayBrowserSources(obs, 9101, logger)).toBe(1);
    expect(pressed).toEqual(["Overlay:refreshnocache"]);
  });

  it("keeps going when one refresh is refused", async () => {
    const { obs, pressed } = fakeObs([
      { inputName: "A", inputKind: "browser_source", url: "http://localhost:9101/scene/a", pressThrows: true },
      { inputName: "B", inputKind: "browser_source", url: "http://localhost:9101/scene/b" },
    ]);
    expect(await refreshOverlayBrowserSources(obs, 9101, logger)).toBe(1);
    expect(pressed).toEqual(["B:refreshnocache"]);
  });
});
