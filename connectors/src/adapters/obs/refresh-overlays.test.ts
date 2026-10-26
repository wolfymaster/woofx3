import { describe, expect, it } from "bun:test";
import { OBS_DEFAULTS } from "../../config/obs";
import { systemTimers, type Timers } from "../../host/deps";
import type { ObsControlOptions } from "./control";
import { isOverlayUrl, type ObsRequester, refreshOverlayBrowserSources } from "./refresh-overlays";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Parameters<typeof refreshOverlayBrowserSources>[2];

const options: ObsControlOptions = { timeoutMs: OBS_DEFAULTS.commandTimeoutMs, timers: systemTimers };

/** A failure status OBS answered with, shaped as obs-websocket-js throws it. */
function obsRefusal(code: number, comment: string): Error {
  return Object.assign(new Error(comment), { code });
}

/** obs-websocket-js's error for a request on a session that has closed. */
const NOT_CONNECTED = new Error("Not connected");

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
  settingsThrows?: Error;
  pressThrows?: Error;
  /** OBS never answers this input's settings request. */
  settingsHangs?: boolean;
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
        if (input?.settingsHangs) {
          return new Promise(() => {});
        }
        if (input?.settingsThrows) {
          throw input.settingsThrows;
        }
        return { inputSettings: { url: input?.url } };
      }
      if (cmd === "PressInputPropertiesButton") {
        const input = inputs.find((i) => i.inputName === args.inputName);
        if (input?.pressThrows) {
          throw input.pressThrows;
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
    expect(await refreshOverlayBrowserSources(obs, 9101, logger, options)).toBe(1);
    expect(pressed).toEqual(["Overlay:refreshnocache"]);
  });

  it("reports that OBS was not asked when it is not connected", async () => {
    expect(await refreshOverlayBrowserSources(null, 9101, logger, options)).toBeNull();
  });

  it("reports that OBS was not asked, rather than throwing, when the input list is unavailable", async () => {
    const { obs } = fakeObs([], { listThrows: true });
    expect(await refreshOverlayBrowserSources(obs, 9101, logger, options)).toBeNull();
  });

  it("skips an input removed between listing and reading and still refreshes the rest", async () => {
    const { obs, pressed } = fakeObs([
      { inputName: "Gone", inputKind: "browser_source", settingsThrows: obsRefusal(600, "No source was found") },
      { inputName: "Overlay", inputKind: "browser_source", url: "http://127.0.0.1:9101/scene/abc" },
    ]);
    expect(await refreshOverlayBrowserSources(obs, 9101, logger, options)).toBe(1);
    expect(pressed).toEqual(["Overlay:refreshnocache"]);
  });

  it("keeps going when one refresh is refused", async () => {
    const { obs, pressed } = fakeObs([
      {
        inputName: "A",
        inputKind: "browser_source",
        url: "http://localhost:9101/scene/a",
        pressThrows: obsRefusal(702, "refused"),
      },
      { inputName: "B", inputKind: "browser_source", url: "http://localhost:9101/scene/b" },
    ]);
    expect(await refreshOverlayBrowserSources(obs, 9101, logger, options)).toBe(1);
    expect(pressed).toEqual(["B:refreshnocache"]);
  });

  // A closed session leaves the walk with nothing seen, which must not read as
  // "no overlays to refresh": the request would be consumed and never retried.
  it("reports that OBS was not asked when the session closes between listing and reading", async () => {
    const { obs, pressed } = fakeObs([
      { inputName: "Overlay", inputKind: "browser_source", settingsThrows: NOT_CONNECTED },
    ]);
    expect(await refreshOverlayBrowserSources(obs, 9101, logger, options)).toBeNull();
    expect(pressed).toEqual([]);
  });

  it("reports that OBS was not asked when the session closes while pressing refresh", async () => {
    const { obs } = fakeObs([
      {
        inputName: "Overlay",
        inputKind: "browser_source",
        url: "http://localhost:9101/scene/abc",
        pressThrows: NOT_CONNECTED,
      },
    ]);
    expect(await refreshOverlayBrowserSources(obs, 9101, logger, options)).toBeNull();
  });

  it("gives up on a request OBS never answers once the deadline passes, and asks for a new session", async () => {
    const timers = manualTimers();
    let timedOut = 0;
    const { obs } = fakeObs([{ inputName: "Overlay", inputKind: "browser_source", settingsHangs: true }]);
    const walk = refreshOverlayBrowserSources(obs, 9101, logger, {
      timeoutMs: 1_000,
      onTimeout: () => timedOut++,
      timers: timers.timers,
    });
    await settle();
    expect(timers.delays()).toEqual([1_000]);
    timers.fire();
    expect(await walk).toBeNull();
    expect(timedOut).toBe(1);
    expect(timers.delays()).toEqual([]);
  });
});

/** Timers the test fires by hand, so a deadline passes without waiting for it. */
function manualTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as number);
    },
    setInterval: () => {
      throw new Error("the overlay refresh sets no intervals");
    },
    clearInterval: () => {
      throw new Error("the overlay refresh sets no intervals");
    },
  };
  return {
    timers,
    delays: () => [...pending.values()].map((t) => t.ms),
    fire() {
      const due = [...pending.values()];
      pending.clear();
      for (const timer of due) {
        timer.fn();
      }
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}
