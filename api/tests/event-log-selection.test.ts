import { describe, expect, test } from "bun:test";
import type { EventLogSettings } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type { EventCatalog, LoggedEvent } from "../src/event-catalog";
import {
  computeEventLogSettings,
  EVENT_LOG_SELECTION_SETTING,
  EventLogSelectionSource,
  readEventLogSelection,
} from "../src/event-log-selection";

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as SharedLogger;

function catalogOf(defaults: string[], others: string[] = []): Map<string, LoggedEvent> {
  return new Map<string, LoggedEvent>([
    ...defaults.map((subject): [string, LoggedEvent] => [subject, { subject, moduleId: "m", onByDefault: true }]),
    ...others.map((subject): [string, LoggedEvent] => [subject, { subject, moduleId: "m", onByDefault: false }]),
  ]);
}

/** A catalog whose set the test changes by hand. */
function fakeCatalog(events: Map<string, LoggedEvent>) {
  let listener: (() => Promise<void> | void) | undefined;
  const catalog = {
    events: events as ReadonlyMap<string, LoggedEvent>,
    onChange(fn: typeof listener) {
      listener = fn;
    },
  };
  const change = async (next: Map<string, LoggedEvent>) => {
    catalog.events = next;
    await listener?.();
  };
  return { catalog: catalog as unknown as EventCatalog, change };
}

function fakeSettings(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  let failReads = 0;
  const db = {
    async getSetting(key: string) {
      if (failReads > 0) {
        failReads--;
        throw new Error("db-proxy down");
      }
      return store.get(key) ?? null;
    },
    async setSetting(key: string, value: string) {
      store.set(key, value);
    },
  };
  return {
    db,
    store,
    failNextReads(count: number) {
      failReads = count;
    },
  };
}

describe("computeEventLogSettings", () => {
  test("enabled is the defaults plus shown, minus hidden, within offered", () => {
    const settings = computeEventLogSettings(
      catalogOf(["channel.follow", "channel.cheer"], ["wheel.landed", "stream.online"]),
      {
        shown: ["wheel.landed", "not.installed"],
        hidden: ["channel.cheer", "also.not.installed"],
      }
    );

    expect(settings).toEqual({
      selection: { shown: ["wheel.landed", "not.installed"], hidden: ["channel.cheer", "also.not.installed"] },
      defaults: ["channel.cheer", "channel.follow"],
      offered: ["channel.cheer", "channel.follow", "stream.online", "wheel.landed"],
      enabled: ["channel.follow", "wheel.landed"],
    });
  });

  test("hidden wins over shown", () => {
    const settings = computeEventLogSettings(catalogOf([], ["wheel.landed"]), {
      shown: ["wheel.landed"],
      hidden: ["wheel.landed"],
    });

    expect(settings.enabled).toEqual([]);
  });
});

describe("readEventLogSelection", () => {
  test("keeps types outside offered and drops duplicates, in the order given", () => {
    expect(readEventLogSelection({ shown: ["b", "a", "b"], hidden: ["c", "c"] })).toEqual({
      shown: ["b", "a"],
      hidden: ["c"],
    });
  });

  test("rejects anything that is not a selection", () => {
    for (const input of [
      null,
      [],
      "x",
      { shown: [] },
      { shown: "a", hidden: [] },
      { shown: [""], hidden: [] },
      { shown: [1], hidden: [] },
      { shown: ["x".repeat(201)], hidden: [] },
      { shown: Array.from({ length: 501 }, (_, i) => `t.${i}`), hidden: [] },
    ]) {
      expect(() => readEventLogSelection(input)).toThrow();
    }
  });
});

describe("EventLogSelectionSource", () => {
  test("applies the defaults until a selection is stored, and reads a stored one on start", async () => {
    const { catalog } = fakeCatalog(catalogOf(["channel.follow"], ["wheel.landed"]));
    const { db } = fakeSettings({
      [EVENT_LOG_SELECTION_SETTING]: JSON.stringify({ shown: ["wheel.landed"], hidden: ["channel.follow"] }),
    });
    const source = new EventLogSelectionSource(catalog, db, logger);
    expect(source.settings.enabled).toEqual(["channel.follow"]);

    await source.start();

    expect(source.settings.enabled).toEqual(["wheel.landed"]);
  });

  test("stores a new selection and tells listeners before it resolves", async () => {
    const { catalog } = fakeCatalog(catalogOf(["channel.follow"], ["wheel.landed"]));
    const { db, store } = fakeSettings();
    const source = new EventLogSelectionSource(catalog, db, logger);
    await source.start();
    const heard: string[][] = [];
    source.onChange((settings: EventLogSettings) => {
      heard.push(settings.enabled);
    });

    const settings = await source.setSelection({ shown: ["wheel.landed", "not.installed"], hidden: [] });

    expect(settings.enabled).toEqual(["channel.follow", "wheel.landed"]);
    expect(heard).toEqual([["channel.follow", "wheel.landed"]]);
    expect(JSON.parse(store.get(EVENT_LOG_SELECTION_SETTING) ?? "")).toEqual({
      shown: ["wheel.landed", "not.installed"],
      hidden: [],
    });
  });

  test("a type of an uninstalled module takes effect again once the module is back", async () => {
    const { catalog, change } = fakeCatalog(catalogOf(["channel.follow"]));
    const { db } = fakeSettings();
    const source = new EventLogSelectionSource(catalog, db, logger);
    await source.start();

    await source.setSelection({ shown: ["wheel.landed"], hidden: [] });
    expect(source.settings.enabled).toEqual(["channel.follow"]);

    await change(catalogOf(["channel.follow"], ["wheel.landed"]));
    expect(source.settings.enabled).toEqual(["channel.follow", "wheel.landed"]);
  });

  test("a malformed selection is refused and the previous one stays", async () => {
    const { catalog } = fakeCatalog(catalogOf(["channel.follow"]));
    const { db, store } = fakeSettings();
    const source = new EventLogSelectionSource(catalog, db, logger);
    await source.start();

    await expect(source.setSelection({ shown: "channel.follow" })).rejects.toThrow();
    expect(store.size).toBe(0);
    expect(source.settings.enabled).toEqual(["channel.follow"]);
  });

  test("an unreadable stored selection falls back to the defaults", async () => {
    const { catalog } = fakeCatalog(catalogOf(["channel.follow"]));
    const { db } = fakeSettings({ [EVENT_LOG_SELECTION_SETTING]: "{not json" });
    const source = new EventLogSelectionSource(catalog, db, logger);

    await source.start();

    expect(source.settings.selection).toEqual({ shown: [], hidden: [] });
    expect(source.settings.enabled).toEqual(["channel.follow"]);
  });

  test("retries a failed read, and a save made meanwhile is not undone by it", async () => {
    const { catalog } = fakeCatalog(catalogOf(["channel.follow"], ["wheel.landed"]));
    const settings = fakeSettings({
      [EVENT_LOG_SELECTION_SETTING]: JSON.stringify({ shown: ["wheel.landed"], hidden: [] }),
    });
    settings.failNextReads(1);
    const source = new EventLogSelectionSource(catalog, settings.db, logger, { minBackoffMs: 5 });

    await source.start();
    expect(source.settings.enabled).toEqual(["channel.follow"]);
    await Bun.sleep(20);
    expect(source.settings.enabled).toEqual(["channel.follow", "wheel.landed"]);

    settings.failNextReads(1);
    const again = new EventLogSelectionSource(catalog, settings.db, logger, { minBackoffMs: 5 });
    await again.start();
    await again.setSelection({ shown: [], hidden: ["channel.follow"] });
    await Bun.sleep(20);
    expect(again.settings.enabled).toEqual([]);
    again.stop();
    source.stop();
  });
});
