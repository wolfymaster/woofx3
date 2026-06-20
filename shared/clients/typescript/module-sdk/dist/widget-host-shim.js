(() => {
  // src/widget-protocol.ts
  var WIDGET_PROTOCOL = "woofx3.widget";
  var PROTOCOL_VERSION = 1;
  var WIDGET_BOOT_GLOBAL = "__WOOFX3_WIDGET_BOOT__";
  function isWidgetProtocolEnvelope(value) {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const msg = value;
    return msg.proto === WIDGET_PROTOCOL && msg.v === PROTOCOL_VERSION && typeof msg.type === "string" && msg.type.length > 0 && typeof msg.nonce === "string" && msg.nonce.length > 0;
  }
  function isWidgetBootPayload(value) {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const boot = value;
    return boot.v === PROTOCOL_VERSION && typeof boot.nonce === "string" && boot.nonce.length > 0 && typeof boot.instanceId === "string" && boot.instanceId.length > 0 && typeof boot.moduleId === "string" && boot.moduleId.length > 0 && (boot.widgetCanonicalId === undefined || typeof boot.widgetCanonicalId === "string") && typeof boot.settings === "object" && boot.settings !== null && Array.isArray(boot.capabilities);
  }

  // src/widget-host-shim.ts
  var SDK_VERSION = "0.1.0";
  var HELLO_RETRY_INTERVAL_MS = 250;
  var SHIM_WANTS = ["storage", "events", "status"];
  function installWidgetHostShim(options = {}) {
    const windowCandidate = options.windowRef ?? globalThis.window;
    if (windowCandidate === undefined || typeof windowCandidate.addEventListener !== "function") {
      console.error("[widget-host-shim] no usable window \u2014 the shim must run inside a widget frame");
      return null;
    }
    const windowRef = windowCandidate;
    const parentCandidate = options.parentRef ?? windowRef.parent;
    if (parentCandidate === undefined || parentCandidate === null || typeof parentCandidate.postMessage !== "function") {
      console.error("[widget-host-shim] no parent window \u2014 cannot speak " + WIDGET_PROTOCOL);
      return null;
    }
    const parentRef = parentCandidate;
    const bootCandidate = windowRef[WIDGET_BOOT_GLOBAL];
    if (!isWidgetBootPayload(bootCandidate)) {
      console.error("[widget-host-shim] missing or malformed " + WIDGET_BOOT_GLOBAL + " boot payload \u2014 frame was not assembled by the overlay host");
      return null;
    }
    const boot = bootCandidate;
    let initialized = false;
    let rejected = false;
    let disposed = false;
    const outQueue = [];
    const pendingGets = new Map;
    const storageSubs = new Map;
    const eventSubs = new Map;
    let nextLocalId = 0;
    function allocId(prefix) {
      nextLocalId += 1;
      return prefix + "-" + nextLocalId;
    }
    function post(message) {
      parentRef.postMessage(message, "*");
    }
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
    const helloMessage = envelope({
      type: "hello",
      instanceId: boot.instanceId,
      moduleId: boot.moduleId,
      sdkVersion: SDK_VERSION,
      wants: SHIM_WANTS.slice()
    });
    let helloTimer;
    function stopHelloLoop() {
      if (helloTimer !== undefined) {
        clearInterval(helloTimer);
        helloTimer = undefined;
      }
    }
    function teardown() {
      disposed = true;
      stopHelloLoop();
      windowRef.removeEventListener("message", onMessage);
      for (const resolve of pendingGets.values()) {
        resolve(null);
      }
      pendingGets.clear();
      storageSubs.clear();
      eventSubs.clear();
      outQueue.length = 0;
    }
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
            supportedVersions: m.supportedVersions
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
            handler(m.event);
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
          return;
        }
      }
    }
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
      }
    };
    const host = {
      settings: Object.freeze({ ...boot.settings }),
      moduleId: boot.moduleId,
      instanceId: boot.instanceId,
      storage,
      onEvent(handler) {
        if (typeof handler !== "function") {
          throw new Error("[widget-host-shim] onEvent requires a handler function");
        }
        const subId = allocId("esub");
        eventSubs.set(subId, handler);
        send(envelope({ type: "events.subscribe", subId }));
        return () => {
          if (!eventSubs.delete(subId)) {
            return;
          }
          send(envelope({ type: "events.unsubscribe", subId }));
        };
      },
      reportStatus(key, value) {
        try {
          send(envelope({
            type: "status.report",
            key,
            value,
            ts: new Date().toISOString()
          }));
        } catch (err) {
          console.error("[widget-host-shim] reportStatus failed", { key, error: err });
        }
      },
      reportComplete(reason) {
        host.reportStatus("complete", reason !== undefined ? { reason } : null);
      }
    };
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

  // src/widget-host-shim.entry.ts
  installWidgetHostShim();
})();
