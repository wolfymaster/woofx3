// The widget host contract: what a widget can rely on from `widgetHost`,
// whichever host it runs against. Each case drives the host the way a widget
// does and the page side the way the overlay does, through `HostHarness`.

import { afterEach, describe, expect, it } from "bun:test";
import { WidgetAssetError } from "@woofx3/module-sdk";
import { type HarnessFactory, type HarnessOptions, type HostHarness, INSTANCE_ID, MODULE_ID } from "./harness";

export function describeWidgetHostContract(name: string, make: HarnessFactory): void {
  describe(`widget host contract: ${name}`, () => {
    let open: HostHarness | null = null;
    async function start(options: HarnessOptions = {}): Promise<HostHarness> {
      open = make(options);
      await open.ready();
      return open;
    }
    afterEach(() => {
      open?.dispose();
      open = null;
    });

    describe("identity", () => {
      it("names its module, placement and settings from the start", async () => {
        const h = await start({ settings: { label: "watchers" } });
        expect(h.host.moduleId).toBe(MODULE_ID);
        expect(h.host.instanceId).toBe(INSTANCE_ID);
        expect(h.host.surface).toBe("scene");
        expect(h.host.settings.label).toBe("watchers");
        expect(Object.isFrozen(h.host.settings)).toBe(true);
        expect(h.host.getResourceUrl("/img/a.png")).toEndWith("/widgets/w1/img/a.png");
      });

      it("lists storage among its capabilities only where storage is given", async () => {
        const given = await start({ storage: {} });
        expect([...given.host.capabilities].sort()).toEqual(["assets", "events", "settings", "status", "storage"]);
        given.dispose();
        const none = await start({ storage: null });
        expect([...none.host.capabilities].sort()).toEqual(["assets", "events", "settings", "status"]);
      });
    });

    describe("arguments", () => {
      it("throws at once for a storage key that is empty, a missing callback, or a handler that is not a function", async () => {
        const h = await start({ storage: {} });
        expect(() => h.host.storage.get("")).toThrow();
        expect(() => h.host.storage.subscribe("", () => {})).toThrow();
        expect(() => h.host.storage.subscribe("count", undefined as never)).toThrow();
        expect(() => h.host.onEvent(undefined as never)).toThrow();
      });
    });

    describe("settings", () => {
      it("reads the streamer's new settings once they change", async () => {
        const h = await start({ settings: { label: "a" } });
        h.setSettings({ label: "b", accent: "#000" });
        await h.settle();
        expect(h.host.settings.label).toBe("b");
        expect(h.host.settings.accent).toBe("#000");
        expect(Object.isFrozen(h.host.settings)).toBe(true);
      });
    });

    describe("storage", () => {
      it("answers get with null for a key it has not seen, and the value once it has", async () => {
        const h = await start({ storage: { count: 7 } });
        expect(await h.host.storage.get("count")).toBeNull();
        h.host.storage.subscribe("count", () => {});
        await h.settle();
        expect(await h.host.storage.get("count")).toBe(7);
        expect(await h.host.storage.get("other")).toBeNull();
      });

      it("calls a subscriber with the current value, then each change, until it unsubscribes", async () => {
        const h = await start({ storage: { count: 7 } });
        const seen: unknown[] = [];
        const unsubscribe = h.host.storage.subscribe("count", (value) => seen.push(value));
        await h.settle();
        h.setStorage("count", 8);
        await h.settle();
        unsubscribe();
        await h.settle();
        h.setStorage("count", 9);
        await h.settle();
        expect(seen).toEqual([7, 8]);
      });

      it("calls a subscriber back with null for a key that holds nothing", async () => {
        const h = await start({ storage: {} });
        const seen: unknown[] = [];
        h.host.storage.subscribe("missing", (value) => seen.push(value));
        await h.settle();
        expect(seen).toEqual([null]);
      });

      it("gives a frame without storage nothing", async () => {
        const h = await start({ storage: null });
        const seen: unknown[] = [];
        h.host.storage.subscribe("count", (value) => seen.push(value));
        h.setStorage("count", 8);
        await h.settle();
        expect(seen).toEqual([]);
        expect(await h.host.storage.get("count")).toBeNull();
      });
    });

    describe("events", () => {
      it("delivers an event as sent, and completes it when the handler returns", async () => {
        const h = await start();
        const got: Array<Record<string, unknown>> = [];
        h.host.onEvent((event) =>
          got.push({
            eventId: event.eventId,
            type: event.type,
            data: event.data,
            source: typeof event.source,
            time: Number.isNaN(Date.parse(event.time)),
          })
        );
        await h.settle();
        h.deliver({ eventId: "e1", type: "chat.message", data: { text: "hi" } });
        await h.settle();
        expect(got).toEqual([
          { eventId: "e1", type: "chat.message", data: { text: "hi" }, source: "string", time: false },
        ]);
        expect(h.completed).toEqual(["e1"]);
      });

      it("with autoComplete off, holds the next event until the widget completes the current one, once", async () => {
        const h = await start();
        const got: Array<{ eventId: string; complete(): void }> = [];
        h.host.onEvent((event) => got.push(event), { autoComplete: false });
        await h.settle();
        h.deliver({ eventId: "e1", type: "t" });
        h.deliver({ eventId: "e2", type: "t" });
        await h.settle();
        expect(got.map((event) => event.eventId)).toEqual(["e1"]);
        got[0]!.complete();
        got[0]!.complete();
        await h.settle();
        expect(got.map((event) => event.eventId)).toEqual(["e1", "e2"]);
        expect(h.completed).toEqual(["e1"]);
      });

      it("lets maxInFlight events be open at once", async () => {
        const h = await start();
        const got: string[] = [];
        h.host.onEvent((event) => got.push(event.eventId), { autoComplete: false, maxInFlight: 2 });
        await h.settle();
        for (const eventId of ["e1", "e2", "e3"]) {
          h.deliver({ eventId, type: "t" });
        }
        await h.settle();
        expect(got).toEqual(["e1", "e2"]);
      });

      it("completes an event whose handler throws, so later events are not held behind it", async () => {
        const h = await start();
        const errors = console.error;
        console.error = () => {};
        try {
          const got: string[] = [];
          h.host.onEvent(
            (event) => {
              got.push(event.eventId);
              if (event.eventId === "e1") {
                throw new Error("boom");
              }
            },
            { autoComplete: false }
          );
          await h.settle();
          h.deliver({ eventId: "e1", type: "t" });
          h.deliver({ eventId: "e2", type: "t" });
          await h.settle();
          expect(h.completed).toEqual(["e1"]);
          expect(got).toEqual(["e1", "e2"]);
        } finally {
          console.error = errors;
        }
      });

      it("delivers an event once, however often it arrives", async () => {
        const h = await start();
        const got: string[] = [];
        h.host.onEvent((event) => got.push(event.eventId));
        await h.settle();
        h.deliver({ eventId: "e1", type: "t" });
        await h.settle();
        h.deliver({ eventId: "e1", type: "t" });
        await h.settle();
        expect(got).toEqual(["e1"]);
      });

      it("hands events to the newest subscription only", async () => {
        const h = await start();
        const first: string[] = [];
        const second: string[] = [];
        h.host.onEvent((event) => first.push(event.eventId));
        await h.settle();
        h.host.onEvent((event) => second.push(event.eventId));
        await h.settle();
        h.deliver({ eventId: "e1", type: "t" });
        await h.settle();
        expect(first).toEqual([]);
        expect(second).toEqual(["e1"]);
      });

      it("delivers nothing before the widget subscribes or after it unsubscribes", async () => {
        const h = await start();
        h.deliver({ eventId: "early", type: "t" });
        await h.settle();
        const got: string[] = [];
        const unsubscribe = h.host.onEvent((event) => got.push(event.eventId));
        await h.settle();
        unsubscribe();
        await h.settle();
        h.deliver({ eventId: "late", type: "t" });
        await h.settle();
        expect(got).toEqual([]);
      });
    });

    describe("status", () => {
      it("reports status and completion in order", async () => {
        const h = await start();
        h.host.reportStatus("progress", { n: 1 });
        h.host.reportComplete("done");
        h.host.reportComplete();
        await h.settle();
        expect(h.reports).toEqual([
          { key: "progress", value: { n: 1 } },
          { key: "complete", value: { reason: "done" } },
          { key: "complete", value: null },
        ]);
      });
    });

    describe("assets", () => {
      const files = {
        [`/assets/modules/${MODULE_ID}/v1/widgets/w1/data.json`]: '{"own":true}',
        "/assets/user/u1/clip.json": '{"clip":1}',
        "/assets/modules/other/v1/secret.json": '{"secret":1}',
      };

      it("reads the widget's own files by relative path", async () => {
        const h = await start({ files });
        const asset = await h.host.assets.load("data.json");
        expect(asset.path).toBe(`/assets/modules/${MODULE_ID}/v1/widgets/w1/data.json`);
        expect(asset.json()).toEqual({ own: true });
      });

      it("reads the streamer's library files by URL or picker value, on any engine origin", async () => {
        const h = await start({ files });
        expect((await h.host.assets.load("https://elsewhere.test/assets/user/u1/clip.json")).text()).toBe('{"clip":1}');
        expect((await h.host.assets.load({ url: "https://engine.test/assets/user/u1/clip.json" })).json()).toEqual({
          clip: 1,
        });
      });

      async function refusal(h: HostHarness, ref: string): Promise<string> {
        try {
          await h.host.assets.load(ref);
          return "loaded";
        } catch (err) {
          return err instanceof WidgetAssetError ? err.code : `threw ${String(err)}`;
        }
      }

      it("refuses another module's files, files off the engine, and files that are not there", async () => {
        const warn = console.warn;
        console.warn = () => {};
        try {
          const h = await start({ files });
          expect(await refusal(h, "https://engine.test/assets/modules/other/v1/secret.json")).toBe("out_of_scope");
          expect(await refusal(h, "https://cdn.example.com/anim.json")).toBe("not_engine_asset");
          expect(await refusal(h, "https://engine.test/assets/user/u1/missing.json")).toBe("not_found");
        } finally {
          console.warn = warn;
        }
      });
    });
  });
}
