// Scene manager: registry + event index. Bridges from the P2 event
// source (WebSocket or parent-frame) down to each P1 widget bridge.
//
// Data structures for O(subscribed) dispatch:
//   eventIndex:   Map<eventType, Set<instanceId>>
//   storageSubs:  Map<"moduleId:key", Set<instanceId>>
//   registry:     Map<instanceId, { bridge, acceptedEvents }>
//
// The manager implements `SceneEventSink` internally — `onFrame`
// routes `storage` and `event` frames to the relevant bridges;
// `onReconnected` fires the `refetchConfig` callback (set by the
// overlay on mount).

import type { WidgetEvent, WidgetStatusReport } from "@woofx3/module-sdk";
import type { OverlayEventsFrame } from "../../../../shared/clients/typescript/api/overlay-events";
import type { SceneEventSource, SceneEventSink } from "./eventSource";
import { widgetEventFromFrame } from "./eventSource";
import type { WidgetBridge } from "./widgetBridge";

export interface SceneManagerOptions {
  eventSource: SceneEventSource;
  onSendStatus?: (report: WidgetStatusReport) => void;
  onControlFrame?: (action: string) => void;
  onSceneUpdated?: () => void;
}

interface BridgeEntry {
  bridge: WidgetBridge;
  acceptedEvents: string[];
}

export class SceneManager {
  private readonly eventSource: SceneEventSource;
  private readonly onSendStatus: ((report: WidgetStatusReport) => void) | undefined;
  private readonly onControlFrame: ((action: string) => void) | undefined;
  private readonly onSceneUpdated: (() => void) | undefined;

  // Widget registry: instanceId -> bridge + accepted event types.
  private readonly registry = new Map<string, BridgeEntry>();

  // Event index: eventType -> Set of instanceIds that want it.
  // Rebuilt on registerBridge; updated by addEventSubscription.
  private readonly eventIndex = new Map<string, Set<string>>();

  // Storage subscriptions: "moduleId:key" -> Set of instanceIds.
  private readonly storageSubs = new Map<string, Set<string>>();

  // Optional callback the overlay sets to trigger a ./config refetch.
  refetchConfig: (() => void) | null = null;

  constructor(options: SceneManagerOptions) {
    this.eventSource = options.eventSource;
    this.onSendStatus = options.onSendStatus;
    this.onControlFrame = options.onControlFrame;
    this.onSceneUpdated = options.onSceneUpdated;
  }

  registerBridge(instanceId: string, bridge: WidgetBridge, acceptedEvents: string[]): void {
    this.registry.set(instanceId, { bridge, acceptedEvents });
    for (const eventType of acceptedEvents) {
      const key = eventIndexKey(eventType);
      let bucket = this.eventIndex.get(key);
      if (!bucket) {
        bucket = new Set();
        this.eventIndex.set(key, bucket);
      }
      bucket.add(instanceId);
    }
  }

  unregisterBridge(instanceId: string): void {
    const entry = this.registry.get(instanceId);
    if (!entry) {
      return;
    }
    for (const eventType of entry.acceptedEvents) {
      const key = eventIndexKey(eventType);
      const bucket = this.eventIndex.get(key);
      if (bucket) {
        bucket.delete(instanceId);
        if (bucket.size === 0) {
          this.eventIndex.delete(key);
        }
      }
    }
    // Remove all storage subscriptions for this instance.
    for (const [storageKey, instances] of this.storageSubs) {
      instances.delete(instanceId);
      if (instances.size === 0) {
        this.storageSubs.delete(storageKey);
      }
    }
    this.registry.delete(instanceId);
  }

  deliverStorage(moduleId: string, key: string, value: unknown): void {
    const storageKey = `${moduleId}:${key}`;
    const instances = this.storageSubs.get(storageKey);
    console.log(`[SceneManager] deliverStorage ${storageKey} → ${instances?.size ?? 0} subscriber(s)`);
    if (!instances || instances.size === 0) {
      return;
    }
    for (const instanceId of instances) {
      const entry = this.registry.get(instanceId);
      if (entry) {
        console.log(`[SceneManager] dispatching storage ${storageKey} to instance ${instanceId}`);
        entry.bridge.sendStorageChanged(moduleId, key, value);
      }
    }
  }

  deliverEvent(event: WidgetEvent): void {
    const key = eventIndexKey(event.type);
    const instances = this.eventIndex.get(key);
    console.log(`[SceneManager] deliverEvent type=${event.type} → ${instances?.size ?? 0} subscriber(s)`);
    if (!instances || instances.size === 0) {
      return;
    }
    for (const instanceId of instances) {
      const entry = this.registry.get(instanceId);
      if (entry) {
        console.log(`[SceneManager] dispatching event type=${event.type} to instance ${instanceId}`);
        entry.bridge.sendEvent(event);
      }
    }
  }

  addStorageSubscription(instanceId: string, moduleId: string, key: string): void {
    const storageKey = `${moduleId}:${key}`;
    let instances = this.storageSubs.get(storageKey);
    if (!instances) {
      instances = new Set();
      this.storageSubs.set(storageKey, instances);
    }
    instances.add(instanceId);
  }

  removeStorageSubscription(instanceId: string, moduleId: string, key: string): void {
    const storageKey = `${moduleId}:${key}`;
    const instances = this.storageSubs.get(storageKey);
    if (!instances) {
      return;
    }
    instances.delete(instanceId);
    if (instances.size === 0) {
      this.storageSubs.delete(storageKey);
    }
  }

  addEventSubscription(instanceId: string, eventType: string): void {
    const key = eventIndexKey(eventType);
    let bucket = this.eventIndex.get(key);
    if (!bucket) {
      bucket = new Set();
      this.eventIndex.set(key, bucket);
    }
    bucket.add(instanceId);
  }

  removeEventSubscription(instanceId: string, eventType: string): void {
    const key = eventIndexKey(eventType);
    const bucket = this.eventIndex.get(key);
    if (!bucket) {
      return;
    }
    bucket.delete(instanceId);
    if (bucket.size === 0) {
      this.eventIndex.delete(key);
    }
  }

  start(): void {
    const sink: SceneEventSink = {
      onFrame: (frame: OverlayEventsFrame) => this.onFrame(frame),
      onReconnected: () => {
        this.refetchConfig?.();
      },
      onConnectionChange: (_connected: boolean) => {},
    };
    this.eventSource.start(sink);
  }

  stop(): void {
    this.eventSource.stop();
  }

  handleWindowMessage(event: MessageEvent): void {
    for (const entry of this.registry.values()) {
      entry.bridge.handleMessage(event);
    }
  }

  private onFrame(frame: OverlayEventsFrame): void {
    console.log(`[SceneManager] onFrame kind=${frame.kind}`, frame);
    switch (frame.kind) {
      case "storage": {
        this.deliverStorage(frame.moduleId, frame.key, frame.value);
        return;
      }
      case "event": {
        const widgetEvent = widgetEventFromFrame(frame);
        this.deliverEvent(widgetEvent);
        return;
      }
      case "scene.updated": {
        this.onSceneUpdated?.();
        return;
      }
      case "control": {
        this.onControlFrame?.(frame.action);
        return;
      }
      default:
        // attach.ready / attach.ack and unknown frames are ignored at
        // this layer (they're handled by the transport itself).
        return;
    }
  }
}

// acceptedEvents entries use the canonical form "{owner}:trigger:{subject}".
// P2 event frames carry only the subject portion — strip the prefix so
// eventIndex lookups match regardless of which format is used.
function eventIndexKey(eventType: string): string {
  const MARKER = ":trigger:";
  const idx = eventType.indexOf(MARKER);
  return idx >= 0 ? eventType.slice(idx + MARKER.length) : eventType;
}
