// One previewed widget: its frame, mounted and answered as an overlay mounts
// and answers a placement (mountWidgetFrame, the WidgetBridge, the event
// queue its subscription registers, the asset cache), with the author in
// place of the engine. Events are the ones the author fires, storage is what
// they set, and everything the widget says back is logged.

import { encodePlacementBoot, type WidgetSurface } from "@woofx3/module-sdk";
import {
  type AssetCache,
  BROWSER_HOST,
  type EventQueueManager,
  generateNonce,
  mountWidgetFrame,
  type PageHost,
  type QueueRegistration,
  settingsUpdate,
  toWidgetEvent,
  type WidgetBridge,
  type WidgetFrame,
} from "../../page";
import { framePath } from "../protocol";
import type { PreviewStorage, StorageTarget } from "./preview-storage";

export type PreviewLogKind = "frame" | "status" | "event" | "asset" | "settings" | "problem";

export interface PreviewLogEntry {
  kind: PreviewLogKind;
  text: string;
}

export interface PreviewFrameOptions {
  slot: HTMLElement;
  moduleId: string;
  widgetId: string;
  surface: WidgetSurface;
  settings: Record<string, unknown>;
  /** The page's bridges, which its message listener hands each message to. */
  bridges: Set<WidgetBridge>;
  queues: EventQueueManager;
  assets: AssetCache;
  storage: PreviewStorage;
  log(entry: PreviewLogEntry): void;
  document?: Pick<Document, "createElement">;
  host?: PageHost;
}

/** What a change of settings did: nothing, patched in through the widget's bindings, or a fresh frame. */
export type SettingsOutcome = "none" | "patch" | "reload";

export class PreviewFrame {
  private readonly instanceId: string;
  private readonly host: PageHost;
  private settings: Record<string, unknown>;
  private frame: WidgetFrame;
  /** The current frame's event subscription and the queue it registered. */
  private subscription: { subId: string; queue: QueueRegistration } | null = null;

  constructor(private readonly options: PreviewFrameOptions) {
    this.instanceId = `preview.${options.widgetId}`;
    this.host = options.host ?? BROWSER_HOST;
    this.settings = options.settings;
    this.frame = this.mount();
  }

  /**
   * Hand `type` and `data` to the widget as an event, through its
   * subscription's queue. False when it has no subscription to take it: on
   * stream such an event is held for the next frame, here it is gone.
   */
  fire(type: string, data: unknown): boolean {
    const eventId = `preview-${generateNonce(this.host.randomBytes)}`;
    const queued = this.options.queues.enqueue(this.instanceId, { eventId, type, key: "", value: data });
    this.options.log(
      queued
        ? { kind: "event", text: `sent ${type} as ${eventId}` }
        : { kind: "problem", text: `${type} not sent: the widget has not subscribed to events (widgetHost.onEvent)` }
    );
    return queued;
  }

  /**
   * Give the widget new settings as the overlay does when a placement is
   * edited: patched in when its script never read what changed, a fresh
   * frame when it did.
   */
  applySettings(next: Record<string, unknown>): SettingsOutcome {
    const outcome = settingsUpdate(this.settings, next, this.frame.bridge.settingsReads());
    this.settings = next;
    if (outcome === "patch") {
      this.frame.bridge.sendSettings(next);
      this.options.log({ kind: "settings", text: "patched in: the widget's script read none of what changed" });
    } else if (outcome === "reload") {
      this.remount("its script read a setting that changed");
    }
    return outcome;
  }

  private remount(reason: string): void {
    this.frame.unmount();
    this.options.log({ kind: "frame", text: `reloaded: ${reason}` });
    this.frame = this.mount();
  }

  unmount(): void {
    this.frame.unmount();
  }

  private mount(): WidgetFrame {
    const { options, instanceId } = this;
    const { log, queues, storage } = options;
    const settings = this.settings;
    let storageTarget: StorageTarget | null = null;
    const loadAsset = options.assets.loaderFor(options.moduleId);

    const frame = mountWidgetFrame({
      slot: options.slot,
      instanceId,
      bridges: options.bridges,
      document: options.document,
      host: this.host,
      src: (nonce) =>
        `${framePath(options.widgetId)}#${encodePlacementBoot({
          nonce,
          instanceId,
          settings,
          linkedResources: {},
          surface: options.surface,
        })}`,
      callbacks: ({ bridge }) => {
        const target: StorageTarget = { sendStorageValue: (key, value) => bridge().sendStorageValue(key, value) };
        storageTarget = target;
        return {
          // A widget playing in an alert is given no storage, as on stream.
          ...(options.surface === "scene" ? { storage: storage.access(target) } : {}),
          onStatusReport: (report) => log({ kind: "status", text: `${report.key} = ${JSON.stringify(report.value)}` }),
          onAssetLoad: (path) =>
            loadAsset(path).then(
              (asset) => {
                log({ kind: "asset", text: `read ${path} (${asset.contentType}, ${asset.bytes.byteLength} bytes)` });
                return asset;
              },
              (err: unknown) => {
                log({ kind: "problem", text: `could not read ${path}: ${err instanceof Error ? err.message : err}` });
                throw err;
              }
            ),
          onEventsSubscribe: (subId, queue) => {
            const previous = this.subscription;
            this.subscription = {
              subId,
              queue: queues.register(
                instanceId,
                queue,
                (item) => bridge().sendEvent(subId, toWidgetEvent(item, this.host.timers.now())),
                (eventId) => log({ kind: "problem", text: `${eventId} timed out before the widget completed it` })
              ),
            };
            if (previous !== null) {
              queues.unregister(previous.queue);
            }
            log({
              kind: "event",
              text: `subscribed to events${queue === undefined ? "" : ` ${JSON.stringify(queue)}`}`,
            });
          },
          onEventsUnsubscribe: (subId) => {
            if (this.subscription?.subId === subId) {
              queues.unregister(this.subscription.queue);
              this.subscription = null;
            }
          },
          onEventComplete: (subId, eventId) => {
            if (this.subscription?.subId === subId) {
              queues.complete(this.subscription.queue, eventId);
            }
            log({ kind: "event", text: `completed ${eventId}` });
          },
          onDispose: () => {
            if (this.subscription !== null) {
              queues.unregister(this.subscription.queue);
              this.subscription = null;
            }
          },
          onRendered: () => log({ kind: "frame", text: "rendered" }),
        };
      },
      onUnmount: () => {
        if (storageTarget !== null) {
          storage.unwatchAll(storageTarget);
        }
      },
    });
    options.assets.warm(options.moduleId, settings);
    return frame;
  }
}
