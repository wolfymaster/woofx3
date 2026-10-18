// The production pairing: the widget host shim in a simulated frame, the
// scene manager's WidgetBridge in a simulated page, and the page components
// the overlay answers the bridge with (module state, the event queue, the
// asset cache). Messages cross as `postMessage` would carry them: cloned,
// asynchronously, with the sender's window as their source.

import { PROTOCOL_VERSION } from "@woofx3/module-sdk";
import {
  installWidgetHostShim,
  type ShimMessageEvent,
  type ShimParentWindow,
  type ShimWindow,
} from "@woofx3/module-sdk/src/widget-host-shim";
import { AssetCache } from "../../public/scene-manager/asset-loader";
import { EventQueueManager, type QueueRegistration, toWidgetEvent } from "../../public/scene-manager/event-queue";
import { ModuleStateCache } from "../../public/scene-manager/module-state";
import { WidgetBridge } from "../../public/scene-manager/widget-bridge";
import {
  drain,
  type HarnessFactory,
  type HarnessOptions,
  type HostHarness,
  INSTANCE_ID,
  MODULE_ID,
  RESOURCE_BASE_URL,
} from "./harness";

const NONCE = "contract-nonce-0123456789";

export const realHarness: HarnessFactory = (options: HarnessOptions): HostHarness => {
  const storageValues = new Map(Object.entries(options.storage ?? {}));
  const files = options.files ?? {};
  const reports: Array<{ key: string; value: unknown }> = [];
  const completed: string[] = [];

  // The frame's window, as the page holds it (`iframe.contentWindow`) and as
  // the shim runs in it.
  const frameListeners: Array<(event: ShimMessageEvent) => void> = [];
  const frameWindow: ShimWindow & { postMessage(message: unknown, targetOrigin: string): void } = {
    __WOOFX3_WIDGET_BOOT__: {
      v: PROTOCOL_VERSION,
      nonce: NONCE,
      instanceId: INSTANCE_ID,
      moduleId: MODULE_ID,
      widgetCanonicalId: `${MODULE_ID}:widget:w1`,
      surface: "scene",
      settings: options.settings ?? {},
      capabilities: [],
      resourceBaseUrl: RESOURCE_BASE_URL,
    },
    location: { hash: "" },
    addEventListener(type, listener): void {
      if (type === "message") {
        frameListeners.push(listener);
      }
    },
    removeEventListener(type, listener): void {
      const at = frameListeners.indexOf(listener);
      if (type === "message" && at >= 0) {
        frameListeners.splice(at, 1);
      }
    },
    postMessage(message: unknown): void {
      const data = structuredClone(message);
      queueMicrotask(() => {
        for (const listener of frameListeners.slice()) {
          listener({ source: pageWindow, data });
        }
      });
    },
  };

  const pageWindow: ShimParentWindow = {
    postMessage(message: unknown): void {
      const data = structuredClone(message);
      queueMicrotask(() => bridge.handleMessage({ source: frameWindow, data } as unknown as MessageEvent));
    },
  };

  const moduleState = new ModuleStateCache(async (_instanceId, key) => storageValues.get(key) ?? null);
  const queues = new EventQueueManager();
  const assets = new AssetCache({
    pageOrigin: "https://engine.test",
    fetchFn: async (url) => {
      const path = `/assets/${new URL(url, "https://engine.test").pathname.slice("/assets/read/".length)}`;
      const body = files[path];
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
    },
  });

  let subscription: { subId: string; queue: QueueRegistration } | null = null;
  const storageTarget = {
    instanceId: INSTANCE_ID,
    sendStorageValue: (key: string, value: unknown) => bridge.sendStorageValue(key, value),
  };

  const bridge = new WidgetBridge(INSTANCE_ID, NONCE, {
    ...(options.storage === null
      ? {}
      : {
          storage: {
            get: (key: string) => moduleState.peek(MODULE_ID, key),
            subscribe: (key: string) => moduleState.watch(MODULE_ID, key, storageTarget),
            unsubscribe: (key: string) => moduleState.unwatch(MODULE_ID, key, storageTarget),
          },
        }),
    onStatusReport: (report) => reports.push({ key: report.key, value: report.value }),
    onAssetLoad: assets.loaderFor(MODULE_ID),
    onEventsSubscribe: (subId, queue) => {
      const previous = subscription;
      subscription = {
        subId,
        queue: queues.register(
          INSTANCE_ID,
          queue,
          (item) => bridge.sendEvent(subId, toWidgetEvent(item, Date.now())),
          () => {}
        ),
      };
      if (previous !== null) {
        queues.unregister(previous.queue);
      }
    },
    onEventsUnsubscribe: (subId) => {
      if (subscription?.subId === subId) {
        queues.unregister(subscription.queue);
        subscription = null;
      }
    },
    onEventComplete: (subId, eventId) => {
      if (subscription?.subId === subId) {
        queues.complete(subscription.queue, eventId);
      }
      completed.push(eventId);
    },
    onDispose: () => {},
  });
  bridge.attach({ contentWindow: frameWindow } as unknown as HTMLIFrameElement);

  const host = installWidgetHostShim({ windowRef: frameWindow, parentRef: pageWindow });
  if (host === null) {
    throw new Error("contract: the shim did not install");
  }

  return {
    host,
    ready: drain,
    settle: drain,
    deliver(event): void {
      queues.enqueue(INSTANCE_ID, {
        eventId: event.eventId,
        type: event.type,
        key: "",
        value: event.data ?? null,
      });
    },
    setStorage(key, value): void {
      storageValues.set(key, value);
      moduleState.apply(MODULE_ID, key, value);
    },
    setSettings(settings): void {
      bridge.sendSettings(settings);
    },
    reports,
    completed,
    dispose(): void {
      bridge.dispose();
    },
  };
};
