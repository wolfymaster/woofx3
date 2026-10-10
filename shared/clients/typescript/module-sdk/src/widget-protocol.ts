// P1 — `woofx3.widget` v1: the widget <-> scene-manager postMessage
// protocol. The widget side is implemented by `widget-host-shim.ts`
// (built to a classic-script IIFE and injected into every assembled
// widget frame); the parent side lives in streamware/ui's widget
// bridge. Both sides import these types — this file is the single
// source of truth for the wire shape.
//
// Design reference:
//   docs/superpowers/specs/2026-06-12-streamware-overlay-architecture-design.md §2.3
//
// Versioning: `v` is bumped on any breaking wire change. A parent that
// receives a `hello` with an unsupported `v` replies `init.reject`
// carrying its `supportedVersions`. Unknown message `type`s are
// ignored by both sides (forward compatibility).

import type { WidgetEvent, WidgetSurface, WidgetTheme } from "./widget-host";
import { isWidgetTransitionState, type WidgetTransitionState } from "./widget-transitions";

export const WIDGET_PROTOCOL = "woofx3.widget";
export type WidgetProtocolName = typeof WIDGET_PROTOCOL;

export const PROTOCOL_VERSION = 1;
export type WidgetProtocolVersion = typeof PROTOCOL_VERSION;

/** Name of the global the frame assembler inlines the boot payload
 *  under. The shim reads `window.__WOOFX3_WIDGET_BOOT__` synchronously
 *  at IIFE time — before any widget code runs. */
export const WIDGET_BOOT_GLOBAL = "__WOOFX3_WIDGET_BOOT__";

/**
 * Boot payload inlined into the assembled frame document ahead of the
 * shim script. Carrying `settings` here (rather than waiting for
 * `init`) keeps `widgetHost.settings` synchronously readable — the
 * FR-4.3 source-compatibility requirement for existing widgets that
 * read settings at IIFE time.
 *
 * `nonce` is a per-frame CSPRNG value; every P1 message in both
 * directions must carry it, and each side drops messages whose nonce
 * does not match (defense against unrelated frames posting into the
 * channel — frames run with opaque origins, so origin checks alone
 * cannot distinguish siblings).
 */
export interface WidgetBootPayload {
  v: WidgetProtocolVersion;
  nonce: string;
  instanceId: string;
  moduleId: string;
  widgetCanonicalId?: string;
  surface: WidgetSurface;
  settings: Record<string, unknown>;
  /** Host capability identifiers (e.g. "storage", "events", "status").
   *  Widgets may feature-detect on this; the set is open-ended. */
  capabilities: string[];
  /** Absolute public base URL for this widget's resource root — the
   *  same value the host used to build the frame's `<base href>`.
   *  `WidgetHost.getResourceUrl(path)` is `resourceBaseUrl + path`,
   *  computed locally with no round trip. */
  resourceBaseUrl: string;
  /** The widget's theme, `null` (or absent, from an older host) for a widget
   *  that declares no theme contract. Becomes `WidgetHost.theme`. */
  theme?: WidgetTheme | null;
  /** The resource instances the widget's module links through its
   *  `resource_ref` settings, setting id to canonical id. Absent from an
   *  older host. Becomes `WidgetHost.linkedResources`. */
  linkedResources?: Record<string, string>;
  /** One of the widget's own transitions to play as the frame first paints:
   *  the placement's entrance, when it is a type the widget declares. Absent
   *  otherwise. See `WidgetTransitionMessage`. */
  transition?: WidgetTransitionState;
  /** The widget's `font` settings and where their stylesheets are served.
   *  Absent for a widget with no font settings, and from an older host. */
  fonts?: WidgetFonts;
}

/** See widget-fonts.ts. */
export interface WidgetFonts {
  /** Ids of the settings whose value is a CSS font-family list. */
  settings: string[];
  /** Path of the scene manager's font stylesheet route; the shim adds
   *  `?family=` and resolves it against the frame URL. */
  stylesheetUrl: string;
}

/**
 * The part of the boot payload that belongs to one placement rather than to
 * the widget. It travels in the frame URL's fragment (`#boot=…`), so the
 * frame document itself is the same for every placement of a widget version
 * and can be cached; the shim merges it over the inlined payload.
 */
export type WidgetPlacementBoot = Pick<
  WidgetBootPayload,
  "nonce" | "instanceId" | "settings" | "linkedResources" | "transition"
>;

/** The fragment parameter carrying a `WidgetPlacementBoot`. */
export const WIDGET_BOOT_FRAGMENT_PARAM = "boot";

/** `boot=<base64url JSON>`, to append to a frame URL after `#`. */
export function encodePlacementBoot(boot: WidgetPlacementBoot): string {
  const bytes = new TextEncoder().encode(JSON.stringify(boot));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${WIDGET_BOOT_FRAGMENT_PARAM}=${base64}`;
}

/** The placement boot in a frame URL's fragment, or null when there is none. */
export function decodePlacementBoot(hash: string): Partial<WidgetPlacementBoot> | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const part of fragment.split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq) !== WIDGET_BOOT_FRAGMENT_PARAM) {
      continue;
    }
    try {
      const base64 = part
        .slice(eq + 1)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Partial<WidgetPlacementBoot>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/**
 * Common fields on every P1 message. Payload fields are spread flat
 * into the envelope (no nested `payload` object) — see the message
 * interfaces below.
 */
export interface WidgetProtocolEnvelope {
  proto: WidgetProtocolName;
  v: WidgetProtocolVersion;
  type: string;
  nonce: string;
}

// ---------------------------------------------------------------------------
// Messages — widget -> scene manager
// ---------------------------------------------------------------------------

/**
 * First message the shim posts, immediately at install time and then
 * every 250ms until `init` arrives (the parent bridge may not be
 * listening yet when the frame boots).
 */
export interface WidgetHelloMessage extends WidgetProtocolEnvelope {
  type: "hello";
  instanceId: string;
  /** `@woofx3/module-sdk` version the shim was built from. */
  sdkVersion: string;
  /** Capabilities the widget side intends to use ("storage",
   *  "events", "status"). Informational — the host does not gate on
   *  this today. */
  wants: string[];
}

/** Correlated storage read — answered by `storage.value` with the same `id`. */
export interface WidgetStorageGetMessage extends WidgetProtocolEnvelope {
  type: "storage.get";
  id: string;
  key: string;
}

/** Open a storage subscription for `key`. Changes arrive as
 *  `storage.changed` carrying the same `subId`. */
export interface WidgetStorageSubscribeMessage extends WidgetProtocolEnvelope {
  type: "storage.subscribe";
  subId: string;
  key: string;
}

export interface WidgetStorageUnsubscribeMessage extends WidgetProtocolEnvelope {
  type: "storage.unsubscribe";
  subId: string;
}

/**
 * Per-subscription client-side dispatch policy — enforced entirely by
 * the host-side (browser scene-manager) queue, never by the backend.
 * The shim only ever carries this up from the widget's `onEvent` call;
 * it never inspects or acts on it.
 */
export interface EventQueueConfig {
  /** Milliseconds to wait for `complete()` before treating a delivery
   *  as timed out. Omitted = no timeout. */
  retryTimeoutMs?: number;
  /** Concurrent uncompleted deliveries allowed to this instance at
   *  once. Omitted = 1. */
  maxInFlight?: number;
  /** `true` (default): handler return = completion, no explicit ack
   *  needed. `false`: the widget must call `event.complete()` (or
   *  `ctx.completeEvent(event)`-equivalent) itself. */
  autoComplete?: boolean;
  /** Safe expression (resolver.ts grammar — ternary/comparisons/arith/
   *  paths, no `eval`, no DOM/global access) evaluated by the host
   *  queue against each arriving `WidgetEvent` to get its priority for
   *  a priority-heap ordering. Omitted = FIFO. */
  priorityExpr?: string;
}

/**
 * Open an event subscription. `types` optionally narrows which event
 * types are delivered; when absent the host delivers every event
 * addressed to the instance. Deliveries arrive as `event.deliver` with the same
 * `subId`. `queue` registers this instance's dispatch policy with the
 * host's per-instance queue — this is the "widget registers itself
 * with a queue configuration" moment.
 */
export interface WidgetEventsSubscribeMessage extends WidgetProtocolEnvelope {
  type: "events.subscribe";
  subId: string;
  types?: string[];
  queue?: EventQueueConfig;
}

export interface WidgetEventsUnsubscribeMessage extends WidgetProtocolEnvelope {
  type: "events.unsubscribe";
  subId: string;
}

/**
 * Widget acknowledges it has finished handling a delivered event —
 * either explicitly (`event.complete()`, required when that
 * subscription's `queue.autoComplete` is `false`) or automatically
 * posted by the shim right after the handler returns (default
 * `autoComplete` behavior). Always sent exactly once per delivered
 * `eventId`; a repeat call is a shim-side no-op (never re-posted).
 */
export interface WidgetEventCompleteMessage extends WidgetProtocolEnvelope {
  type: "event.complete";
  subId: string;
  eventId: string;
}

/** `widgetHost.reportStatus` on the wire — the parent forwards it onto
 *  the existing `widget.event` NATS path. */
export interface WidgetStatusReportMessage extends WidgetProtocolEnvelope {
  type: "status.report";
  key: string;
  value: unknown;
  /** RFC3339 timestamp taken at report time on the widget side. */
  ts: string;
}

/**
 * The settings the widget's script has read through `host.settings`, sent
 * as they are first read. A change to any of these reloads the widget; a
 * change to any other setting is applied in place through its bindings
 * (`settings.changed`). `all` means the script read every setting at once
 * (spread them, listed their keys), so every change reloads it.
 */
export interface WidgetSettingsReadsMessage extends WidgetProtocolEnvelope {
  type: "settings.reads";
  keys: string[];
  all: boolean;
}

/**
 * The frame has loaded and painted. The host waits for this before showing a
 * frame that replaces another, so a reload never shows a blank widget.
 */
export interface WidgetRenderedMessage extends WidgetProtocolEnvelope {
  type: "rendered";
}

// ---------------------------------------------------------------------------
// Messages — scene manager -> widget
// ---------------------------------------------------------------------------

/**
 * Handshake completion. `settings` / `capabilities` echo the boot
 * payload (boot is authoritative for the synchronous `host.settings`
 * surface).
 */
export interface WidgetInitMessage extends WidgetProtocolEnvelope {
  type: "init";
  settings: Record<string, unknown>;
  capabilities: string[];
}

/** Handshake refusal (e.g. unsupported protocol version). Terminal:
 *  the shim stops re-posting `hello` and drops its queue. */
export interface WidgetInitRejectMessage extends WidgetProtocolEnvelope {
  type: "init.reject";
  reason: string;
  supportedVersions: number[];
}

/** Answer to `storage.get` — `id` correlates, `value` is the host's
 *  cached value or `null` when none has been observed. */
export interface WidgetStorageValueMessage extends WidgetProtocolEnvelope {
  type: "storage.value";
  id: string;
  key: string;
  value: unknown;
}

/** One change delivery on an open storage subscription. The host fires
 *  this immediately after `storage.subscribe` when it holds a cached
 *  value for the key, then on every subsequent change. */
export interface WidgetStorageChangedMessage extends WidgetProtocolEnvelope {
  type: "storage.changed";
  subId: string;
  key: string;
  value: unknown;
  /** RFC3339 timestamp from the originating storage-change event. */
  occurredAt: string;
}

/** One event delivery on an open event subscription. `event` preserves
 *  the typed `WidgetEvent` shape end to end, including the host-
 *  assigned `eventId` the widget echoes back in `event.complete`. */
export interface WidgetEventDeliverMessage extends WidgetProtocolEnvelope {
  type: "event.deliver";
  subId: string;
  event: WidgetEvent;
}

/** The placement's settings changed: the whole new set, not a diff. Sent
 *  only when no changed setting is one the widget's script has read (see
 *  `settings.reads`); the shim applies it through the setting bindings. */
export interface WidgetSettingsChangedMessage extends WidgetProtocolEnvelope {
  type: "settings.changed";
  settings: Record<string, unknown>;
}

/**
 * Play one of the widget's own transitions, or, with `null`, clear the last
 * one so the widget shows as it is. Sent when the placement enters or leaves
 * with a type the widget declares; the generic types are played by the host
 * on the frame's box and never reach the widget. The shim marks the frame's
 * root element (see `WidgetTransitionState`) and the widget's CSS animates.
 */
export interface WidgetTransitionMessage extends WidgetProtocolEnvelope {
  type: "transition";
  transition: WidgetTransitionState | null;
}

/** Teardown order. The shim drops every subscription, resolves pending
 *  reads with `null`, and goes inert. */
export interface WidgetDisposeMessage extends WidgetProtocolEnvelope {
  type: "dispose";
  reason: string;
}

// ---------------------------------------------------------------------------
// Messages — either direction
// ---------------------------------------------------------------------------

/** Liveness probe. The receiver echoes `ts` back in `pong` so the
 *  sender can compute round-trip time. Epoch milliseconds. */
export interface WidgetPingMessage extends WidgetProtocolEnvelope {
  type: "ping";
  ts: number;
}

export interface WidgetPongMessage extends WidgetProtocolEnvelope {
  type: "pong";
  ts: number;
}

// ---------------------------------------------------------------------------
// Unions + guards
// ---------------------------------------------------------------------------

/** Messages originated by the widget (shim) side. */
export type WidgetToHostMessage =
  | WidgetHelloMessage
  | WidgetStorageGetMessage
  | WidgetStorageSubscribeMessage
  | WidgetStorageUnsubscribeMessage
  | WidgetEventsSubscribeMessage
  | WidgetEventsUnsubscribeMessage
  | WidgetEventCompleteMessage
  | WidgetStatusReportMessage
  | WidgetSettingsReadsMessage
  | WidgetRenderedMessage
  | WidgetPingMessage
  | WidgetPongMessage;

/** Messages originated by the scene-manager (parent) side. */
export type HostToWidgetMessage =
  | WidgetInitMessage
  | WidgetInitRejectMessage
  | WidgetStorageValueMessage
  | WidgetStorageChangedMessage
  | WidgetEventDeliverMessage
  | WidgetSettingsChangedMessage
  | WidgetTransitionMessage
  | WidgetDisposeMessage
  | WidgetPingMessage
  | WidgetPongMessage;

export type WidgetProtocolMessage = WidgetToHostMessage | HostToWidgetMessage;

/**
 * Envelope-level guard: proto / v / type / nonce present and well
 * formed. Deliberately does NOT restrict `type` to the known set —
 * receivers validate the envelope, then switch on `type` and ignore
 * unknown values (forward compatibility).
 */
export function isWidgetProtocolEnvelope(value: unknown): value is WidgetProtocolEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const msg = value as Record<string, unknown>;
  return (
    msg.proto === WIDGET_PROTOCOL &&
    msg.v === PROTOCOL_VERSION &&
    typeof msg.type === "string" &&
    msg.type.length > 0 &&
    typeof msg.nonce === "string" &&
    msg.nonce.length > 0
  );
}

/**
 * Boot-payload guard used by the shim before trusting the inlined
 * global. Fails closed: any missing or mis-typed required field
 * rejects the whole payload.
 */
export function isWidgetBootPayload(value: unknown): value is WidgetBootPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const boot = value as Record<string, unknown>;
  return (
    boot.v === PROTOCOL_VERSION &&
    typeof boot.nonce === "string" &&
    boot.nonce.length > 0 &&
    typeof boot.instanceId === "string" &&
    boot.instanceId.length > 0 &&
    typeof boot.moduleId === "string" &&
    boot.moduleId.length > 0 &&
    (boot.widgetCanonicalId === undefined || typeof boot.widgetCanonicalId === "string") &&
    (boot.surface === "scene" || boot.surface === "alert") &&
    typeof boot.settings === "object" &&
    boot.settings !== null &&
    Array.isArray(boot.capabilities) &&
    typeof boot.resourceBaseUrl === "string" &&
    boot.resourceBaseUrl.length > 0 &&
    (boot.theme === undefined || boot.theme === null || isWidgetTheme(boot.theme)) &&
    (boot.linkedResources === undefined || isStringRecord(boot.linkedResources, false)) &&
    (boot.transition === undefined || isWidgetTransitionState(boot.transition)) &&
    (boot.fonts === undefined || isWidgetFonts(boot.fonts))
  );
}

function isWidgetFonts(value: unknown): value is WidgetFonts {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const fonts = value as Record<string, unknown>;
  return (
    Array.isArray(fonts.settings) &&
    fonts.settings.every((id) => typeof id === "string") &&
    typeof fonts.stylesheetUrl === "string" &&
    fonts.stylesheetUrl.length > 0
  );
}

function isStringRecord(value: unknown, allowNull: boolean): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((v) => typeof v === "string" || (allowNull && v === null));
}

export function isWidgetTheme(value: unknown): value is WidgetTheme {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const theme = value as Record<string, unknown>;
  return (
    (theme.id === null || typeof theme.id === "string") &&
    typeof theme.contractVersion === "number" &&
    isStringRecord(theme.variables, false) &&
    isStringRecord(theme.assets, true) &&
    isStringRecord(theme.defaultAssets, true) &&
    (theme.fallback === null || theme.fallback === "missing" || theme.fallback === "incompatible")
  );
}

declare global {
  interface Window {
    /** Inlined by streamware's frame assembler ahead of the shim
     *  script. Absent everywhere except assembled widget frames. */
    __WOOFX3_WIDGET_BOOT__?: WidgetBootPayload;
  }
}
