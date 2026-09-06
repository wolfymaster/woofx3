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
import { PROTOCOL_VERSION, WIDGET_BOOT_GLOBAL, WIDGET_PROTOCOL, isWidgetBootPayload, isWidgetProtocolEnvelope, } from "./widget-protocol";
/** Keep in sync with package.json `version`. Carried on `hello`. */
export const SDK_VERSION = "0.1.0";
/** `hello` re-post cadence until the parent answers with `init`. */
export const HELLO_RETRY_INTERVAL_MS = 250;
/** Capabilities this shim implementation uses — `hello.wants`. */
const SHIM_WANTS = ["storage", "events", "status"];
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
export function installWidgetHostShim(options = {}) {
    const windowCandidate = options.windowRef ?? globalThis.window;
    if (windowCandidate === undefined || typeof windowCandidate.addEventListener !== "function") {
        console.error("[widget-host-shim] no usable window — the shim must run inside a widget frame");
        return null;
    }
    const windowRef = windowCandidate;
    const parentCandidate = options.parentRef ?? windowRef.parent;
    if (parentCandidate === undefined ||
        parentCandidate === null ||
        typeof parentCandidate.postMessage !== "function") {
        console.error("[widget-host-shim] no parent window — cannot speak " + WIDGET_PROTOCOL);
        return null;
    }
    const parentRef = parentCandidate;
    const bootCandidate = windowRef[WIDGET_BOOT_GLOBAL];
    if (!isWidgetBootPayload(bootCandidate)) {
        console.error("[widget-host-shim] missing or malformed " +
            WIDGET_BOOT_GLOBAL +
            " boot payload — frame was not assembled by the overlay host");
        return null;
    }
    const boot = bootCandidate;
    // ── Connection state ─────────────────────────────────────────────
    let initialized = false;
    let rejected = false;
    let disposed = false;
    const outQueue = [];
    const pendingGets = new Map();
    const storageSubs = new Map();
    const eventSubs = new Map();
    // Delivery ids the shim has already posted `event.complete` for —
    // guards double-sends whether the widget calls `.complete()` itself,
    // the shim auto-completes on handler return, or both.
    const completedEventIds = new Set();
    let nextLocalId = 0;
    function allocId(prefix) {
        nextLocalId += 1;
        return prefix + "-" + nextLocalId;
    }
    function post(message) {
        // Opaque origin: "*" is the only usable targetOrigin. Trust is
        // established by source identity + nonce, not origin.
        parentRef.postMessage(message, "*");
    }
    /** Queue until `init`; drop after `dispose` / `init.reject`. */
    function send(message) {
        if (disposed || rejected) {
            return;
        }
        if (!initialized) {
            outQueue.push(message);
            return;
        }
        post(message);
    }
    function envelope(body) {
        return { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: boot.nonce, ...body };
    }
    // ── Hello loop ───────────────────────────────────────────────────
    const helloMessage = envelope({
        type: "hello",
        instanceId: boot.instanceId,
        moduleId: boot.moduleId,
        sdkVersion: SDK_VERSION,
        wants: SHIM_WANTS.slice(),
    });
    // setInterval/clearInterval via globalThis so the shim works in any
    // host that provides timers (browser, test runner).
    let helloTimer;
    function stopHelloLoop() {
        if (helloTimer !== undefined) {
            clearInterval(helloTimer);
            helloTimer = undefined;
        }
    }
    // ── Teardown ─────────────────────────────────────────────────────
    function teardown() {
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
        completedEventIds.clear();
        outQueue.length = 0;
    }
    // ── Inbound dispatch ─────────────────────────────────────────────
    function onMessage(event) {
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
        const m = msg;
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
                const sub = eventSubs.get(m.subId);
                if (sub === undefined || typeof m.event !== "object" || m.event === null) {
                    return;
                }
                const rawEvent = m.event;
                if (typeof rawEvent.eventId !== "string" || rawEvent.eventId.length === 0) {
                    return;
                }
                const subId = m.subId;
                const eventId = rawEvent.eventId;
                const completeOnce = () => {
                    if (completedEventIds.has(eventId)) {
                        return;
                    }
                    completedEventIds.add(eventId);
                    send(envelope({ type: "event.complete", subId, eventId }));
                };
                const delivered = { ...rawEvent, complete: completeOnce };
                sub.handler(delivered);
                // Default (autoComplete !== false): the handler having returned
                // *is* completion — post it now unless the widget already
                // called complete() itself inside the handler (idempotent).
                if (sub.queue?.autoComplete !== false) {
                    completeOnce();
                }
                return;
            }
            case "dispose": {
                teardown();
                return;
            }
            case "ping": {
                send(envelope({ type: "pong", ts: typeof m.ts === "number" ? m.ts : 0 }));
                return;
            }
            default: {
                // Unknown types tolerated — forward compatibility.
                return;
            }
        }
    }
    // ── WidgetHost surface ───────────────────────────────────────────
    const storage = {
        get(key) {
            if (typeof key !== "string" || key.length === 0) {
                throw new Error("[widget-host-shim] storage.get requires a non-empty key");
            }
            return new Promise((resolve) => {
                if (disposed || rejected) {
                    resolve(null);
                    return;
                }
                const id = allocId("get");
                pendingGets.set(id, resolve);
                send(envelope({ type: "storage.get", id, key }));
            });
        },
        subscribe(key, cb) {
            if (typeof key !== "string" || key.length === 0) {
                throw new Error("[widget-host-shim] storage.subscribe requires a non-empty key");
            }
            if (typeof cb !== "function") {
                throw new Error("[widget-host-shim] storage.subscribe requires a callback");
            }
            const subId = allocId("ssub");
            storageSubs.set(subId, { key, cb });
            send(envelope({ type: "storage.subscribe", subId, key }));
            return () => {
                if (!storageSubs.delete(subId)) {
                    return;
                }
                send(envelope({ type: "storage.unsubscribe", subId }));
            };
        },
    };
    const host = {
        settings: Object.freeze({ ...boot.settings }),
        moduleId: boot.moduleId,
        instanceId: boot.instanceId,
        storage,
        getResourceUrl(path) {
            return boot.resourceBaseUrl.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
        },
        onEvent(handler, queue) {
            if (typeof handler !== "function") {
                throw new Error("[widget-host-shim] onEvent requires a handler function");
            }
            const subId = allocId("esub");
            eventSubs.set(subId, { handler, queue });
            send(envelope({ type: "events.subscribe", subId, queue }));
            return () => {
                if (!eventSubs.delete(subId)) {
                    return;
                }
                send(envelope({ type: "events.unsubscribe", subId }));
            };
        },
        reportStatus(key, value) {
            // Best-effort by contract: never throws, silently dropped when
            // the channel is gone.
            try {
                send(envelope({
                    type: "status.report",
                    key,
                    value,
                    ts: new Date().toISOString(),
                }));
            }
            catch (err) {
                console.error("[widget-host-shim] reportStatus failed", { key, error: err });
            }
        },
        reportComplete(reason) {
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
