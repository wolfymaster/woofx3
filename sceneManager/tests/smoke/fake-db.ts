// The db proxy as the smoke suite's scene manager sees it: one scene with an
// alert area and a text widget, the built-in widget catalog, and records of
// the deliveries it is asked to keep. A method the suite did not expect the
// scene manager to call fails loudly and is listed in `unexpected`, so a new
// dependency on the database shows up here instead of passing silently.

import type { DbClient } from "../../src/db";

export const SCENE_ID = "scene-smoke";
export const OVERLAY_TOKEN = "ovl_smoke_token";
export const ALERT_AREA_ID = "w-alerts";
export const TEXT_ID = "w-text";

const OK = { code: "OK" as const, message: "" };

function widget(manifestId: string, extra: Record<string, unknown> = {}) {
  return {
    id: `woofx3-${manifestId}`,
    moduleId: "woofx3",
    manifestId,
    name: manifestId,
    description: "",
    directory: "",
    alertTypes: [],
    settingsSchema: "",
    createdByType: "",
    createdByRef: "",
    entry: "",
    surfaces: ["scene", "alert"],
    hostsSurface: "",
    taxonomy: [],
    behaviorKinds: { transitions: [], effects: [] },
    ...extra,
  };
}

export interface FakeDb {
  client: DbClient;
  /** Methods called that this fake does not answer. */
  unexpected: string[];
  /** Scene events recorded, in order. */
  sceneEvents: Array<Record<string, unknown>>;
  /** Module storage values `getModuleStorageValue` answers, by `{namespace}:{key}`. */
  storage: Map<string, unknown>;
}

export function createFakeDb(): FakeDb {
  const unexpected: string[] = [];
  const sceneEvents: Array<Record<string, unknown>> = [];
  const storage = new Map<string, unknown>();
  const scene = {
    id: SCENE_ID,
    name: "Smoke",
    widgetsJson: JSON.stringify([
      {
        id: ALERT_AREA_ID,
        widgetCanonicalId: "woofx3:widget:alert",
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        settings: { name: "default" },
      },
      {
        id: TEXT_ID,
        widgetCanonicalId: "woofx3:widget:text",
        position: { x: 10, y: 10 },
        size: { width: 300, height: 100 },
        settings: { text: "hello" },
      },
    ]),
    layoutJson: JSON.stringify({ width: 1920, height: 1080 }),
    hasDraft: false,
    draftWidgetsJson: "",
    draftLayoutJson: "",
    editorStateJson: "",
  };

  const answers: Record<string, (...args: any[]) => Promise<unknown>> = {
    ping: async () => {},
    resolveOverlayToken: async (req: { token: string }) =>
      req.token === OVERLAY_TOKEN ? { status: OK, sceneId: SCENE_ID } : { status: { code: "NOT_FOUND", message: "" } },
    getScene: async (req: { id: string }) =>
      req.id === SCENE_ID ? { status: OK, scene } : { status: { code: "NOT_FOUND", message: "no scene" } },
    writeScene: async () => ({ status: OK, scene }),
    updateScene: async () => ({ status: OK, scene }),
    listWidgets: async () => ({
      status: OK,
      widgets: [widget("alert", { hostsSurface: "alert", surfaces: ["scene"] }), widget("text")],
    }),
    getModuleKeyForModuleId: async (moduleId: string) => moduleId,
    listModuleSettings: async () => [],
    getModuleStorageValue: async (namespace: string, key: string) => storage.get(`${namespace}:${key}`) ?? null,
    getResourceInstance: async () => null,
    listOpenSceneEventDeliveries: async () => ({ status: OK, deliveries: [] }),
    recordSceneEvent: async (req: Record<string, unknown>) => {
      sceneEvents.push(req);
      return { status: OK, sceneEvent: { id: `evt-${sceneEvents.length}`, ...req } };
    },
    recordSceneEventDelivery: async () => OK,
    recordSceneEventCompletion: async () => OK,
    upsertWidgetStatus: async () => ({ status: OK }),
    updateAlertLifecycle: async () => ({ status: OK }),
  };

  const client = new Proxy({} as DbClient, {
    get(_target, prop) {
      if (typeof prop !== "string" || prop === "then") {
        return undefined;
      }
      const answer = answers[prop];
      if (answer !== undefined) {
        return answer;
      }
      return async () => {
        unexpected.push(prop);
        throw new Error(`fake db: ${prop} is not answered by the smoke suite`);
      };
    },
  });

  return { client, unexpected, sceneEvents, storage };
}
