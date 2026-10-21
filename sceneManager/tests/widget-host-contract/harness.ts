// What the widget host contract suite drives: a `widgetHost` as a widget sees
// it, and the page side that feeds it. One implementation runs the real shim
// against the real bridge and page components; the other is the SDK's mock,
// which widget authors develop and test against. The suite holds both to the
// same behavior, so a widget that works against the mock works on stream.

import type { WidgetHost } from "@woofx3/module-sdk";

export const MODULE_ID = "mod-1";
export const INSTANCE_ID = "inst-1";
/** Under the module's own engine assets, as a real frame's is. */
export const RESOURCE_BASE_URL = `https://engine.test/assets/modules/${MODULE_ID}/v1/widgets/w1/`;

export interface HarnessOptions {
  settings?: Record<string, unknown>;
  /** The module's storage, by bare key; null for a frame that is given no storage. */
  storage?: Record<string, unknown> | null;
  /** Files the engine serves, by engine path (`/assets/user/...`, `/assets/modules/...`). */
  files?: Record<string, string>;
}

export interface ContractEvent {
  eventId: string;
  type: string;
  data?: unknown;
}

export interface HostHarness {
  readonly host: WidgetHost;
  /** Resolves once the host has everything a widget is told at start (the handshake, where there is one). */
  ready(): Promise<void>;
  /** Resolves once every message already sent has been handled on both sides. */
  settle(): Promise<void>;
  /** An event for this placement arrives at the page. */
  deliver(event: ContractEvent): void;
  /** A storage key changes on the engine. */
  setStorage(key: string, value: unknown): void;
  /** The streamer changes the placement's settings. */
  setSettings(settings: Record<string, unknown>): void;
  /** What the widget reported, in order. */
  readonly reports: ReadonlyArray<{ key: string; value: unknown }>;
  /** The event ids the widget completed, in order. */
  readonly completed: readonly string[];
  dispose(): void;
}

export type HarnessFactory = (options: HarnessOptions) => HostHarness;

/** A few macrotask turns: long enough for any chain of microtasks and zero-delay timers to drain. */
export async function drain(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
