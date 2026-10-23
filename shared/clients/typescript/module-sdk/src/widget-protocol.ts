// P1 — `woofx3.widget` v1: the widget <-> scene-manager postMessage
// protocol. The widget side is implemented by `widget-host-shim.ts`
// (built to a classic-script IIFE and injected into every assembled
// widget frame); the parent side is the widget host's bridge
// (shared/clients/typescript/widget-host/page/widget-bridge.ts). Both sides import
// these types — this file is the single source of truth for the wire
// shape.
//
// Versioning: `v` is bumped on any breaking wire change. A parent that
// receives a `hello` with an unsupported `v` replies `init.reject`
// carrying its `supportedVersions`. Unknown message `type`s are
// ignored by both sides (forward compatibility).

import { isWidgetAssetErrorCode, type WidgetAssetErrorCode } from "./widget-assets";
import { isWidgetBehaviorState, type WidgetBehaviorState } from "./widget-behaviors";
import type { WidgetEvent, WidgetSurface, WidgetTheme } from "./widget-host";

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
 * `init`) keeps `widgetHost.settings` synchronously readable, as
 * existing widgets that read settings at IIFE time require.
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
  /** The placement's entrance, when the widget plays it itself (see
   *  `WidgetBehaviorMessage`). Marked before the widget's own scripts run, so
   *  content that types itself in is never first shown whole; the host sends
   *  the same behavior again as the widget actually enters, which restarts it
   *  then. Absent otherwise. */
  behavior?: WidgetBehaviorState;
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
 * and can be cached; the shim merges it over the inlined payload. `surface`
 * is the placement's too: the cached document says "scene", and a frame the
 * host shows as part of an alert says "alert" here.
 */
export type WidgetPlacementBoot = Pick<
  WidgetBootPayload,
  "nonce" | "instanceId" | "settings" | "linkedResources" | "behavior" | "surface"
>;

/** The fragment parameter carrying a `WidgetPlacementBoot`. */
export const WIDGET_BOOT_FRAGMENT_PARAM = "boot";

/**
 * `boot=<base64url JSON>`, to append to a frame URL after `#`. A frame whose
 * document inlines the placement already (an alert's widget) takes only what
 * the fragment adds, such as its entrance.
 */
export function encodePlacementBoot(boot: Partial<WidgetPlacementBoot>): string {
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
 * Correlated file read (`widgetHost.assets.load`), answered by `asset.value`
 * or `asset.error` with the same `id`. `path` is an engine asset path the
 * shim resolved the widget's reference to (see `engineAssetPath`); the host
 * decides whether this widget may read it.
 */
export interface WidgetAssetLoadMessage extends WidgetProtocolEnvelope {
  type: "asset.load";
  id: string;
  path: string;
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
  /** Safe expression (widget-host page/expression.ts grammar — ternary/comparisons/arith/
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
 *
 * `handles` means the widget redraws itself on every change
 * (`widgetHost.onSettingsChange`): whatever it has read, every change is
 * applied in place, and later reads are not reported. A host that does not
 * know the field reloads as the reads say, which is always safe.
 */
export interface WidgetSettingsReadsMessage extends WidgetProtocolEnvelope {
  type: "settings.reads";
  keys: string[];
  all: boolean;
  handles?: boolean;
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

/** Answer to `asset.load`: the file's bytes, copied into the frame. */
export interface WidgetAssetValueMessage extends WidgetProtocolEnvelope {
  type: "asset.value";
  id: string;
  contentType: string;
  bytes: ArrayBuffer;
}

/** Answer to `asset.load` when the file cannot be read, and why. */
export interface WidgetAssetErrorMessage extends WidgetProtocolEnvelope {
  type: "asset.error";
  id: string;
  code: WidgetAssetErrorCode;
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
 * Play one of the widget's own behaviors from now, replacing the last one of
 * its type, or, with `null`, clear every behavior so the widget shows as it
 * is. Sent as a transition or effect of a kind the host does not play itself
 * starts or is withdrawn; the host's own kinds play on the frame's box and
 * never reach the widget. The shim marks the frame's root element (see
 * widget-behaviors.ts) and the widget's CSS animates.
 */
export interface WidgetBehaviorMessage extends WidgetProtocolEnvelope {
  type: "behavior";
  behavior: WidgetBehaviorState | null;
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
  | WidgetAssetLoadMessage
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
  | WidgetAssetValueMessage
  | WidgetAssetErrorMessage
  | WidgetEventDeliverMessage
  | WidgetSettingsChangedMessage
  | WidgetBehaviorMessage
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
    (boot.behavior === undefined || isWidgetBehaviorState(boot.behavior)) &&
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

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * What a host can give a widget. The boot payload lists what the host may
 * offer; `init` lists what this frame actually gets (an alert's widget has
 * no storage, say), and is what `widgetHost.capabilities` reports.
 */
export const WIDGET_CAPABILITIES = ["storage", "events", "status", "settings", "assets"] as const;
export type WidgetCapability = (typeof WIDGET_CAPABILITIES)[number];

export function isWidgetCapability(value: unknown): value is WidgetCapability {
  return typeof value === "string" && (WIDGET_CAPABILITIES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Reading messages
// ---------------------------------------------------------------------------

/** A message as its sender writes it, before the envelope is added. */
export type WidgetMessageBody<M extends WidgetProtocolEnvelope> = M extends unknown
  ? Omit<M, "proto" | "v" | "nonce">
  : never;

/**
 * The envelope of a message on this frame's channel: the protocol, this
 * frame's nonce, a type, and this version. `hello` and `init.reject` are
 * read at any version, since they are how the two sides learn they differ.
 */
function readEnvelope(value: unknown, nonce: string): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const msg = value as Record<string, unknown>;
  if (msg.proto !== WIDGET_PROTOCOL || msg.nonce !== nonce || typeof msg.type !== "string" || msg.type === "") {
    return null;
  }
  const negotiating = msg.type === "hello" || msg.type === "init.reject";
  if (negotiating ? typeof msg.v !== "number" : msg.v !== PROTOCOL_VERSION) {
    return null;
  }
  return msg;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function eventQueueConfig(value: unknown): EventQueueConfig | undefined {
  if (!plainObject(value)) {
    return undefined;
  }
  const config: EventQueueConfig = {};
  if (typeof value.retryTimeoutMs === "number" && value.retryTimeoutMs > 0) {
    config.retryTimeoutMs = value.retryTimeoutMs;
  }
  if (typeof value.maxInFlight === "number" && value.maxInFlight >= 1) {
    config.maxInFlight = Math.floor(value.maxInFlight);
  }
  if (typeof value.autoComplete === "boolean") {
    config.autoComplete = value.autoComplete;
  }
  if (typeof value.priorityExpr === "string") {
    config.priorityExpr = value.priorityExpr;
  }
  return config;
}

/**
 * A message from the widget on the channel with `nonce`, typed and with its
 * fields checked, or null when it is not one: another channel's, malformed,
 * or of a type this version does not know (ignored, for forward
 * compatibility). The host reads every inbound message through this.
 */
export function parseWidgetToHostMessage(value: unknown, nonce: string): WidgetToHostMessage | null {
  const m = readEnvelope(value, nonce);
  if (m === null) {
    return null;
  }
  const envelope: Omit<WidgetProtocolEnvelope, "type"> = {
    proto: WIDGET_PROTOCOL,
    v: m.v as WidgetProtocolVersion,
    nonce,
  };
  switch (m.type) {
    case "hello":
      return {
        ...envelope,
        type: "hello",
        instanceId: typeof m.instanceId === "string" ? m.instanceId : "",
        sdkVersion: typeof m.sdkVersion === "string" ? m.sdkVersion : "",
        wants: stringList(m.wants),
      };
    case "storage.get":
      return nonEmptyString(m.id) && typeof m.key === "string"
        ? { ...envelope, type: "storage.get", id: m.id, key: m.key }
        : null;
    case "storage.subscribe":
      return nonEmptyString(m.subId) && typeof m.key === "string"
        ? { ...envelope, type: "storage.subscribe", subId: m.subId, key: m.key }
        : null;
    case "storage.unsubscribe":
      return nonEmptyString(m.subId) ? { ...envelope, type: "storage.unsubscribe", subId: m.subId } : null;
    case "asset.load":
      return nonEmptyString(m.id) && typeof m.path === "string"
        ? { ...envelope, type: "asset.load", id: m.id, path: m.path }
        : null;
    case "events.subscribe": {
      if (!nonEmptyString(m.subId)) {
        return null;
      }
      const message: WidgetEventsSubscribeMessage = { ...envelope, type: "events.subscribe", subId: m.subId };
      if (Array.isArray(m.types)) {
        message.types = stringList(m.types);
      }
      const queue = eventQueueConfig(m.queue);
      if (queue !== undefined) {
        message.queue = queue;
      }
      return message;
    }
    case "events.unsubscribe":
      return nonEmptyString(m.subId) ? { ...envelope, type: "events.unsubscribe", subId: m.subId } : null;
    case "event.complete":
      return nonEmptyString(m.subId) && nonEmptyString(m.eventId)
        ? { ...envelope, type: "event.complete", subId: m.subId, eventId: m.eventId }
        : null;
    case "status.report":
      return typeof m.key === "string"
        ? {
            ...envelope,
            type: "status.report",
            key: m.key,
            value: m.value,
            ts: typeof m.ts === "string" ? m.ts : "",
          }
        : null;
    case "settings.reads":
      return {
        ...envelope,
        type: "settings.reads",
        keys: stringList(m.keys),
        all: m.all === true,
        ...(m.handles === true ? { handles: true } : {}),
      };
    case "rendered":
      return { ...envelope, type: "rendered" };
    case "ping":
    case "pong":
      return { ...envelope, type: m.type, ts: typeof m.ts === "number" ? m.ts : 0 };
    default:
      return null;
  }
}

/**
 * A message from the host on the channel with `nonce`, typed and with its
 * fields checked, or null when it is not one. The shim reads every inbound
 * message through this.
 */
export function parseHostToWidgetMessage(value: unknown, nonce: string): HostToWidgetMessage | null {
  const m = readEnvelope(value, nonce);
  if (m === null) {
    return null;
  }
  const envelope: Omit<WidgetProtocolEnvelope, "type"> = {
    proto: WIDGET_PROTOCOL,
    v: m.v as WidgetProtocolVersion,
    nonce,
  };
  switch (m.type) {
    case "init":
      return {
        ...envelope,
        type: "init",
        settings: plainObject(m.settings) ? m.settings : {},
        capabilities: stringList(m.capabilities),
      };
    case "init.reject":
      return {
        ...envelope,
        type: "init.reject",
        reason: typeof m.reason === "string" ? m.reason : "",
        supportedVersions: Array.isArray(m.supportedVersions)
          ? m.supportedVersions.filter((v): v is number => typeof v === "number")
          : [],
      };
    case "storage.value":
      return nonEmptyString(m.id) && typeof m.key === "string"
        ? { ...envelope, type: "storage.value", id: m.id, key: m.key, value: m.value === undefined ? null : m.value }
        : null;
    case "storage.changed":
      return nonEmptyString(m.subId) && typeof m.key === "string"
        ? {
            ...envelope,
            type: "storage.changed",
            subId: m.subId,
            key: m.key,
            value: m.value,
            occurredAt: typeof m.occurredAt === "string" ? m.occurredAt : "",
          }
        : null;
    case "asset.value":
      return nonEmptyString(m.id) && m.bytes instanceof ArrayBuffer
        ? {
            ...envelope,
            type: "asset.value",
            id: m.id,
            contentType: typeof m.contentType === "string" ? m.contentType : "",
            bytes: m.bytes,
          }
        : null;
    case "asset.error":
      return nonEmptyString(m.id)
        ? { ...envelope, type: "asset.error", id: m.id, code: isWidgetAssetErrorCode(m.code) ? m.code : "unavailable" }
        : null;
    case "event.deliver": {
      if (!nonEmptyString(m.subId) || !plainObject(m.event)) {
        return null;
      }
      const event = m.event as Partial<WidgetEvent>;
      return typeof event.type === "string" && nonEmptyString(event.eventId)
        ? { ...envelope, type: "event.deliver", subId: m.subId, event: event as WidgetEvent }
        : null;
    }
    case "settings.changed":
      return plainObject(m.settings) ? { ...envelope, type: "settings.changed", settings: m.settings } : null;
    case "behavior":
      return m.behavior === null || isWidgetBehaviorState(m.behavior)
        ? { ...envelope, type: "behavior", behavior: m.behavior }
        : null;
    case "dispose":
      return { ...envelope, type: "dispose", reason: typeof m.reason === "string" ? m.reason : "" };
    case "ping":
    case "pong":
      return { ...envelope, type: m.type, ts: typeof m.ts === "number" ? m.ts : 0 };
    default:
      return null;
  }
}

declare global {
  interface Window {
    /** Inlined by the scene manager's frame assembler ahead of the shim
     *  script. Absent everywhere except assembled widget frames. */
    __WOOFX3_WIDGET_BOOT__?: WidgetBootPayload;
  }
}
