// Child-side P1 runtime: implements the public `WidgetHost` interface
// over `woofx3.widget` v1 postMessage to the parent scene manager.
//
// Built by `bun run build:shim` into `dist/widget-host-shim.js` — a
// self-contained classic-script IIFE the frame assembler injects into
// every widget frame BEFORE the widget's own scripts (and before
// `<base>`). Existing widgets read `window.widgetHost` at IIFE time,
// so this module installs the host synchronously: settings come from
// the inlined boot payload, not from the async `init` handshake.
//
// Trust model (design §2.3, §5.2.10): the frame runs with an opaque
// origin (`sandbox="allow-scripts"`), so `targetOrigin` is "*" on the
// way out and origin checks are useless on the way in. Instead every
// inbound message must (1) come from `window.parent` (`event.source`
// identity), (2) carry the protocol envelope, (3) carry the per-frame
// CSPRNG nonce from the boot payload. Anything else is dropped.

import type {
  WidgetEvent,
  WidgetEventHandler,
  WidgetHost,
  WidgetHostStorage,
} from "./widget-host";
import {
  PROTOCOL_VERSION,
  WIDGET_BOOT_GLOBAL,
  WIDGET_PROTOCOL,
  isWidgetBootPayload,
  isWidgetProtocolEnvelope,
  type WidgetBootPayload,
  type WidgetToHostMessage,
} from "./widget-protocol";

/** Keep in sync with package.json `version`. Carried on `hello`. */
export const SDK_VERSION = "0.1.0";

/** `hello` re-post cadence until the parent answers with `init`. */
export const HELLO_RETRY_INTERVAL_MS = 250;

/** Capabilities this shim implementation uses — `hello.wants`. */
const SHIM_WANTS = ["storage", "events", "status"];

// ---------------------------------------------------------------------------
// Injectable environment (testability without jsdom)
// ---------------------------------------------------------------------------

export interface ShimMessageEvent {
  source: unknown;
  data: unknown;
}

/** The slice of the parent window the shim talks to. */
export interface ShimParentWindow {
  postMessage(message: unknown, targetOrigin: string): void;
}

/** The slice of the frame's own window the shim needs. */
export interface ShimWindow {
  addEventListener(type: "message", listener: (event: ShimMessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: ShimMessageEvent) => void): void;
  __WOOFX3_WIDGET_BOOT__?: unknown;
  widgetHost?: WidgetHost;
  parent?: unknown;
}

export interface InstallWidgetHostShimOptions {
  /** Defaults to the global `window`. */
  windowRef?: ShimWindow;
  /** Defaults to `windowRef.parent`. */
  parentRef?: ShimParentWindow;
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Read + validate the boot payload, define `windowRef.widgetHost`
 * synchronously, post `hello`, and start the P1 message loop.
 *
 * Returns the installed host, or `null` (after exactly one
 * `console.error`) when the environment is unusable — no window, no
 * parent, or a missing/malformed boot payload. A widget loaded
 * outside an assembled frame gets a loud failure, not a half-host.
 */
export function installWidgetHostShim(
  options: InstallWidgetHostShimOptions = {}
): WidgetHost | null {
  const windowCandidate = options.windowRef ?? (globalThis as { window?: ShimWindow }).window;
  if (windowCandidate === undefined || typeof windowCandidate.addEventListener !== "function") {
    console.error(
      "[widget-host-shim] no usable window — the shim must run inside a widget frame"
    );
    return null;
  }
  const windowRef: ShimWindow = windowCandidate;

  const parentCandidate = options.parentRef ?? windowRef.parent;
  if (
    parentCandidate === undefined ||
    parentCandidate === null ||
    typeof (parentCandidate as ShimParentWindow).postMessage !== "function"
  ) {
    console.error("[widget-host-shim] no parent window — cannot speak " + WIDGET_PROTOCOL);
    return null;
  }
  const parentRef = parentCandidate as ShimParentWindow;

  const bootCandidate = windowRef[WIDGET_BOOT_GLOBAL as "__WOOFX3_WIDGET_BOOT__"];
  if (!isWidgetBootPayload(bootCandidate)) {
    console.error(
      "[widget-host-shim] missing or malformed " +
        WIDGET_BOOT_GLOBAL +
        " boot payload — frame was not assembled by the overlay host"
    );
    return null;
  }
  const boot: WidgetBootPayload = bootCandidate;

  // ── Connection state ─────────────────────────────────────────────
  let initialized = false;
  let rejected = false;
  let disposed = false;
  const outQueue: WidgetToHostMessage[] = [];

  const pendingGets = new Map<string, (value: unknown) => void>();
  const storageSubs = new Map<string, { key: string; cb: (value: unknown) => void }>();
  const eventSubs = new Map<string, WidgetEventHandler>();
  let nextLocalId = 0;

  function allocId(prefix: string): string {
    nextLocalId += 1;
    return prefix + "-" + nextLocalId;
  }

  function post(message: WidgetToHostMessage): void {
    // Opaque origin: "*" is the only usable targetOrigin. Trust is
    // established by source identity + nonce, not origin.
    parentRef.postMessage(message, "*");
  }

  /** Queue until `init`; drop after `dispose` / `init.reject`. */
  function send(message: WidgetToHostMessage): void {
    if (disposed || rejected) {
      return;
    }
    if (!initialized) {
      outQueue.push(message);
      return;
    }
    post(message);
  }

  function envelope<T extends Omit<WidgetToHostMessage, "proto" | "v" | "nonce">>(
    body: T
  ): T & { proto: typeof WIDGET_PROTOCOL; v: typeof PROTOCOL_VERSION; nonce: string } {
    return { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: boot.nonce, ...body };
  }

  // ── Hello loop ───────────────────────────────────────────────────
  const helloMessage = envelope({
    type: "hello" as const,
    instanceId: boot.instanceId,
    sdkVersion: SDK_VERSION,
    wants: SHIM_WANTS.slice(),
  });

  // setInterval/clearInterval via globalThis so the shim works in any
  // host that provides timers (browser, test runner).
  let helloTimer: ReturnType<typeof setInterval> | undefined;

  function stopHelloLoop(): void {
    if (helloTimer !== undefined) {
      clearInterval(helloTimer);
      helloTimer = undefined;
    }
  }

  // ── Teardown ─────────────────────────────────────────────────────
  function teardown(): void {
    disposed = true;
    stopHelloLoop();
    windowRef.removeEventListener("message", onMessage);
    // Pending reads resolve null (never leave a widget awaiting forever).
    for (const resolve of pendingGets.values()) {
      resolve(null);
    }
    pendingGets.clear();
    storageSubs.clear();
    eventSubs.clear();
    outQueue.length = 0;
  }

  // ── Inbound dispatch ─────────────────────────────────────────────
  function onMessage(event: ShimMessageEvent): void {
    if (event.source !== parentRef) {
      return;
    }
    const msg = event.data;
    if (!isWidgetProtocolEnvelope(msg)) {
      return;
    }
    if (msg.nonce !== boot.nonce) {
      return;
    }
    if (disposed) {
      return;
    }

    // Envelope validated; payload fields are read defensively below.
    const m = msg as unknown as Record<string, unknown>;
    switch (msg.type) {
      case "init": {
        if (initialized || rejected) {
          return;
        }
        initialized = true;
        stopHelloLoop();
        const queued = outQueue.splice(0, outQueue.length);
        for (const pending of queued) {
          post(pending);
        }
        return;
      }
      case "init.reject": {
        rejected = true;
        stopHelloLoop();
        outQueue.length = 0;
        console.error("[widget-host-shim] init rejected by host", {
          reason: m.reason,
          supportedVersions: m.supportedVersions,
        });
        return;
      }
      case "storage.value": {
        if (typeof m.id !== "string") {
          return;
        }
        const resolve = pendingGets.get(m.id);
        if (resolve !== undefined) {
          pendingGets.delete(m.id);
          resolve(m.value === undefined ? null : m.value);
        }
        return;
      }
      case "storage.changed": {
        if (typeof m.subId !== "string") {
          return;
        }
        const sub = storageSubs.get(m.subId);
        if (sub !== undefined) {
          sub.cb(m.value);
        }
        return;
      }
      case "event.deliver": {
        if (typeof m.subId !== "string") {
          return;
        }
        const handler = eventSubs.get(m.subId);
        if (handler !== undefined && typeof m.event === "object" && m.event !== null) {
          handler(m.event as WidgetEvent);
        }
        return;
      }
      case "dispose": {
        teardown();
        return;
      }
      case "ping": {
        send(envelope({ type: "pong" as const, ts: typeof m.ts === "number" ? m.ts : 0 }));
        return;
      }
      default: {
        // Unknown types tolerated — forward compatibility.
        return;
      }
    }
  }

  // ── WidgetHost surface ───────────────────────────────────────────
  const storage: WidgetHostStorage = {
    get(key: string): Promise<unknown> {
      if (typeof key !== "string" || key.length === 0) {
        throw new Error("[widget-host-shim] storage.get requires a non-empty key");
      }
      return new Promise<unknown>((resolve) => {
        if (disposed || rejected) {
          resolve(null);
          return;
        }
        const id = allocId("get");
        pendingGets.set(id, resolve);
        send(envelope({ type: "storage.get" as const, id, key }));
      });
    },
    subscribe(key: string, cb: (value: unknown) => void): () => void {
      if (typeof key !== "string" || key.length === 0) {
        throw new Error("[widget-host-shim] storage.subscribe requires a non-empty key");
      }
      if (typeof cb !== "function") {
        throw new Error("[widget-host-shim] storage.subscribe requires a callback");
      }
      const subId = allocId("ssub");
      storageSubs.set(subId, { key, cb });
      send(envelope({ type: "storage.subscribe" as const, subId, key }));
      return () => {
        if (!storageSubs.delete(subId)) {
          return;
        }
        send(envelope({ type: "storage.unsubscribe" as const, subId }));
      };
    },
  };

  const host: WidgetHost = {
    settings: Object.freeze({ ...boot.settings }),
    moduleId: boot.moduleId,
    instanceId: boot.instanceId,
    storage,
    onEvent(handler: WidgetEventHandler): () => void {
      if (typeof handler !== "function") {
        throw new Error("[widget-host-shim] onEvent requires a handler function");
      }
      const subId = allocId("esub");
      eventSubs.set(subId, handler);
      send(envelope({ type: "events.subscribe" as const, subId }));
      return () => {
        if (!eventSubs.delete(subId)) {
          return;
        }
        send(envelope({ type: "events.unsubscribe" as const, subId }));
      };
    },
    reportStatus(key: string, value: unknown): void {
      // Best-effort by contract: never throws, silently dropped when
      // the channel is gone.
      try {
        send(
          envelope({
            type: "status.report" as const,
            key,
            value,
            ts: new Date().toISOString(),
          })
        );
      } catch (err) {
        console.error("[widget-host-shim] reportStatus failed", { key, error: err });
      }
    },
    reportComplete(reason?: string): void {
      host.reportStatus("complete", reason !== undefined ? { reason } : null);
    },
  };

  // Install synchronously, then open the channel. Widgets that run
  // right after this script see a fully usable `window.widgetHost`.
  windowRef.widgetHost = host;
  windowRef.addEventListener("message", onMessage);
  post(helloMessage);
  helloTimer = setInterval(() => {
    if (!initialized && !rejected && !disposed) {
      post(helloMessage);
    }
  }, HELLO_RETRY_INTERVAL_MS);

  return host;
}
