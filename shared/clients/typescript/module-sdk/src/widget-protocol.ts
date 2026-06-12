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

import type { WidgetEvent } from "./widget-host";

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
  settings: Record<string, unknown>;
  /** Host capability identifiers (e.g. "storage", "events", "status").
   *  Widgets may feature-detect on this; the set is open-ended. */
  capabilities: string[];
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
 * Open an event subscription. `types` optionally narrows beyond the
 * instance's `acceptedEvents`; when absent the host delivers every
 * accepted event. Deliveries arrive as `event.deliver` with the same
 * `subId`.
 */
export interface WidgetEventsSubscribeMessage extends WidgetProtocolEnvelope {
  type: "events.subscribe";
  subId: string;
  types?: string[];
}

export interface WidgetEventsUnsubscribeMessage extends WidgetProtocolEnvelope {
  type: "events.unsubscribe";
  subId: string;
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

// ---------------------------------------------------------------------------
// Messages — scene manager -> widget
// ---------------------------------------------------------------------------

/**
 * Handshake completion. `settings` / `capabilities` echo the boot
 * payload (boot is authoritative for the synchronous `host.settings`
 * surface); `acceptedEvents` is the instance's resolved event-type
 * allowlist for visibility on the widget side.
 */
export interface WidgetInitMessage extends WidgetProtocolEnvelope {
  type: "init";
  settings: Record<string, unknown>;
  capabilities: string[];
  acceptedEvents: string[];
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
 *  the typed `WidgetEvent` shape end to end. */
export interface WidgetEventDeliverMessage extends WidgetProtocolEnvelope {
  type: "event.deliver";
  subId: string;
  event: WidgetEvent;
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
  | WidgetStatusReportMessage
  | WidgetPingMessage
  | WidgetPongMessage;

/** Messages originated by the scene-manager (parent) side. */
export type HostToWidgetMessage =
  | WidgetInitMessage
  | WidgetInitRejectMessage
  | WidgetStorageValueMessage
  | WidgetStorageChangedMessage
  | WidgetEventDeliverMessage
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
    typeof boot.settings === "object" &&
    boot.settings !== null &&
    Array.isArray(boot.capabilities)
  );
}

declare global {
  interface Window {
    /** Inlined by streamware's frame assembler ahead of the shim
     *  script. Absent everywhere except assembled widget frames. */
    __WOOFX3_WIDGET_BOOT__?: WidgetBootPayload;
  }
}
