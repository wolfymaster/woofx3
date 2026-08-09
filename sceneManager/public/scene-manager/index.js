// ../shared/clients/typescript/module-sdk/dist/widget-protocol.js
var WIDGET_PROTOCOL = "woofx3.widget";
var PROTOCOL_VERSION = 1;
function isWidgetProtocolEnvelope(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const msg = value;
  return msg.proto === WIDGET_PROTOCOL && msg.v === PROTOCOL_VERSION && typeof msg.type === "string" && msg.type.length > 0 && typeof msg.nonce === "string" && msg.nonce.length > 0;
}
// public/scene-manager/widget-bridge.ts
class WidgetBridge {
  instanceId;
  nonce;
  callbacks;
  iframe = null;
  moduleId = null;
  initialized = false;
  shimStorageSubs = new Map;
  shimSubToKey = new Map;
  shimEventSubs = new Set;
  constructor(instanceId, nonce, callbacks) {
    this.instanceId = instanceId;
    this.nonce = nonce;
    this.callbacks = callbacks;
  }
  attach(iframe) {
    this.iframe = iframe;
  }
  onFrameLoad() {
    this.initialized = false;
    this.moduleId = null;
    this.shimStorageSubs.clear();
    this.shimSubToKey.clear();
    this.shimEventSubs.clear();
  }
  handleMessage(event) {
    if (!this.iframe || event.source !== this.iframe.contentWindow) {
      return;
    }
    const data = event.data;
    if (typeof data !== "object" || data === null) {
      return;
    }
    const msg = data;
    if (msg.proto !== WIDGET_PROTOCOL) {
      return;
    }
    if (msg.nonce !== this.nonce) {
      return;
    }
    const type = typeof msg.type === "string" ? msg.type : "";
    if (!type) {
      return;
    }
    if (type === "hello") {
      const v = msg.v;
      const incomingModuleId = typeof msg.moduleId === "string" ? msg.moduleId : "";
      if (v !== PROTOCOL_VERSION) {
        this.sendReject(`unsupported protocol version ${v}`);
        return;
      }
      this.moduleId = incomingModuleId;
      this.initialized = true;
      this.sendInit({});
      return;
    }
    if (!isWidgetProtocolEnvelope(data)) {
      return;
    }
    switch (type) {
      case "storage.get": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const id = typeof msg.id === "string" ? msg.id : "";
        const key = typeof msg.key === "string" ? msg.key : "";
        const value = this.callbacks.onStorageGet(this.moduleId, key);
        this.post({ type: "storage.value", id, key, value });
        return;
      }
      case "storage.subscribe": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const key = typeof msg.key === "string" ? msg.key : "";
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        const storageKey = `${this.moduleId}:${key}`;
        let subIds = this.shimStorageSubs.get(storageKey);
        if (!subIds) {
          subIds = new Set;
          this.shimStorageSubs.set(storageKey, subIds);
        }
        subIds.add(subId);
        this.shimSubToKey.set(subId, storageKey);
        this.callbacks.onStorageSubscribe(this.moduleId, key, this.instanceId);
        return;
      }
      case "storage.unsubscribe": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        const storageKey = this.shimSubToKey.get(subId);
        if (!storageKey) {
          return;
        }
        this.shimSubToKey.delete(subId);
        const subIds = this.shimStorageSubs.get(storageKey);
        if (subIds) {
          subIds.delete(subId);
          if (subIds.size === 0) {
            this.shimStorageSubs.delete(storageKey);
          }
        }
        const colonIdx = storageKey.indexOf(":");
        const key = colonIdx >= 0 ? storageKey.slice(colonIdx + 1) : storageKey;
        this.callbacks.onStorageUnsubscribe(this.moduleId, key, this.instanceId);
        return;
      }
      case "events.subscribe": {
        if (!this.initialized) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        if (!subId) {
          return;
        }
        this.shimEventSubs.add(subId);
        const queue = isEventQueueConfig(msg.queue) ? msg.queue : undefined;
        this.callbacks.onEventsSubscribe(subId, queue);
        return;
      }
      case "events.unsubscribe": {
        if (!this.initialized) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        this.shimEventSubs.delete(subId);
        this.callbacks.onEventsUnsubscribe(subId);
        return;
      }
      case "event.complete": {
        if (!this.initialized) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        const eventId = typeof msg.eventId === "string" ? msg.eventId : "";
        if (!subId || !eventId) {
          return;
        }
        this.callbacks.onEventComplete(subId, eventId);
        return;
      }
      case "status.report": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        this.callbacks.onStatusReport({
          moduleId: this.moduleId,
          instanceId: this.instanceId,
          key: typeof msg.key === "string" ? msg.key : "",
          value: msg.value,
          ts: typeof msg.ts === "string" ? msg.ts : new Date().toISOString()
        });
        return;
      }
      default:
        return;
    }
  }
  sendInit(settings) {
    this.post({
      type: "init",
      settings,
      capabilities: ["storage", "events", "status"],
      acceptedEvents: []
    });
  }
  sendReject(reason) {
    this.post({
      type: "init.reject",
      reason,
      supportedVersions: [PROTOCOL_VERSION]
    });
  }
  sendStorageChanged(moduleId, key, value) {
    if (!this.initialized) {
      return;
    }
    const storageKey = `${moduleId}:${key}`;
    const subIds = this.shimStorageSubs.get(storageKey);
    const occurredAt = new Date().toISOString();
    if (subIds && subIds.size > 0) {
      for (const subId of subIds) {
        this.post({ type: "storage.changed", subId, key, value, occurredAt });
      }
    } else {
      this.post({ type: "storage.changed", subId: storageKey, key, value, occurredAt });
    }
  }
  sendEvent(subId, event) {
    if (!this.initialized || !this.shimEventSubs.has(subId)) {
      return false;
    }
    this.post({ type: "event.deliver", subId, event });
    return true;
  }
  dispose() {
    this.post({ type: "dispose", reason: "scene-manager-dispose" });
    this.callbacks.onDispose();
  }
  detach() {
    this.iframe = null;
    this.initialized = false;
    this.moduleId = null;
    this.shimStorageSubs.clear();
    this.shimSubToKey.clear();
    this.shimEventSubs.clear();
  }
  post(payload) {
    const win = this.iframe?.contentWindow;
    if (!win) {
      return;
    }
    win.postMessage({
      proto: WIDGET_PROTOCOL,
      v: PROTOCOL_VERSION,
      nonce: this.nonce,
      ...payload
    }, "*");
  }
}
function isEventQueueConfig(value) {
  return typeof value === "object" && value !== null;
}

// public/scene-manager/resolver.ts
function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === `
` || c === "\r") {
      i += 1;
      continue;
    }
    if (c >= "0" && c <= "9" || c === "." && src[i + 1] >= "0" && src[i + 1] <= "9") {
      let j = i + 1;
      while (j < src.length && (src[j] >= "0" && src[j] <= "9" || src[j] === ".")) {
        j += 1;
      }
      out.push({ kind: "num", value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const next = src[j + 1];
          s += next === "n" ? `
` : next === "t" ? "\t" : next === "r" ? "\r" : next;
          j += 2;
          continue;
        }
        s += src[j];
        j += 1;
      }
      if (j >= src.length) {
        throw new Error("unterminated string");
      }
      out.push({ kind: "str", value: s });
      i = j + 1;
      continue;
    }
    if (c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c === "_" || c === "$") {
      let j = i + 1;
      while (j < src.length && (src[j] >= "a" && src[j] <= "z" || src[j] >= "A" && src[j] <= "Z" || src[j] >= "0" && src[j] <= "9" || src[j] === "_" || src[j] === "$")) {
        j += 1;
      }
      out.push({ kind: "ident", value: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    const three = src.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      out.push({ kind: "punct", value: three });
      i += 3;
      continue;
    }
    if (two === "==" || two === "!=" || two === ">=" || two === "<=" || two === "&&" || two === "||") {
      out.push({ kind: "punct", value: two });
      i += 2;
      continue;
    }
    if ("+-*/%(),.[]?:!<>".includes(c)) {
      out.push({ kind: "punct", value: c });
      i += 1;
      continue;
    }
    throw new Error(`unexpected character: ${c}`);
  }
  return out;
}
function evaluateExpression(src, ctx) {
  let tokens;
  try {
    tokens = tokenize(src);
  } catch {
    return;
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (kind, value) => {
    const t = tokens[pos];
    if (!t) {
      return null;
    }
    if (t.kind !== kind) {
      return null;
    }
    if (value !== undefined && t.value !== value) {
      return null;
    }
    pos += 1;
    return t;
  };
  const parseTernary = () => {
    const cond = parseOr();
    if (eat("punct", "?")) {
      const a = parseTernary();
      if (!eat("punct", ":")) {
        throw new Error("expected ':' in ternary");
      }
      const b = parseTernary();
      return cond ? a : b;
    }
    return cond;
  };
  const parseOr = () => {
    let left = parseAnd();
    while (eat("punct", "||")) {
      const right = parseAnd();
      left = left || right;
    }
    return left;
  };
  const parseAnd = () => {
    let left = parseEquality();
    while (eat("punct", "&&")) {
      const right = parseEquality();
      left = left && right;
    }
    return left;
  };
  const parseEquality = () => {
    let left = parseComparison();
    while (true) {
      const op = peek();
      if (!op || op.kind !== "punct") {
        break;
      }
      if (op.value === "==") {
        pos += 1;
        left = left == parseComparison();
      } else if (op.value === "!=") {
        pos += 1;
        left = left != parseComparison();
      } else if (op.value === "===") {
        pos += 1;
        left = left === parseComparison();
      } else if (op.value === "!==") {
        pos += 1;
        left = left !== parseComparison();
      } else {
        break;
      }
    }
    return left;
  };
  const parseComparison = () => {
    let left = parseAdditive();
    while (true) {
      const op = peek();
      if (!op || op.kind !== "punct") {
        break;
      }
      if (op.value === ">") {
        pos += 1;
        left = left > parseAdditive();
      } else if (op.value === "<") {
        pos += 1;
        left = left < parseAdditive();
      } else if (op.value === ">=") {
        pos += 1;
        left = left >= parseAdditive();
      } else if (op.value === "<=") {
        pos += 1;
        left = left <= parseAdditive();
      } else {
        break;
      }
    }
    return left;
  };
  const parseAdditive = () => {
    let left = parseMultiplicative();
    while (true) {
      const op = peek();
      if (!op || op.kind !== "punct") {
        break;
      }
      if (op.value === "+") {
        pos += 1;
        const right = parseMultiplicative();
        left = typeof left === "string" || typeof right === "string" ? `${left ?? ""}${right ?? ""}` : left + right;
      } else if (op.value === "-") {
        pos += 1;
        left = left - parseMultiplicative();
      } else {
        break;
      }
    }
    return left;
  };
  const parseMultiplicative = () => {
    let left = parseUnary();
    while (true) {
      const op = peek();
      if (!op || op.kind !== "punct") {
        break;
      }
      if (op.value === "*") {
        pos += 1;
        left = left * parseUnary();
      } else if (op.value === "/") {
        pos += 1;
        left = left / parseUnary();
      } else if (op.value === "%") {
        pos += 1;
        left = left % parseUnary();
      } else {
        break;
      }
    }
    return left;
  };
  const parseUnary = () => {
    if (eat("punct", "-")) {
      return -parseUnary();
    }
    if (eat("punct", "!")) {
      return !parseUnary();
    }
    return parsePrimary();
  };
  const parsePrimary = () => {
    const t = peek();
    if (!t) {
      throw new Error("unexpected end of expression");
    }
    if (t.kind === "num") {
      pos += 1;
      return t.value;
    }
    if (t.kind === "str") {
      pos += 1;
      return t.value;
    }
    if (t.kind === "punct" && t.value === "(") {
      pos += 1;
      const v = parseTernary();
      if (!eat("punct", ")")) {
        throw new Error("expected ')'");
      }
      return v;
    }
    if (t.kind === "ident") {
      pos += 1;
      if (t.value === "true") {
        return true;
      }
      if (t.value === "false") {
        return false;
      }
      if (t.value === "null") {
        return null;
      }
      if (t.value === "undefined") {
        return;
      }
      let cur = ctx[t.value];
      while (true) {
        if (eat("punct", ".")) {
          const name = eat("ident");
          if (!name) {
            throw new Error("expected identifier after '.'");
          }
          cur = cur == null ? undefined : cur[name.value];
          continue;
        }
        if (eat("punct", "[")) {
          const idx = parseTernary();
          if (!eat("punct", "]")) {
            throw new Error("expected ']'");
          }
          cur = cur == null ? undefined : cur[idx];
          continue;
        }
        break;
      }
      return cur;
    }
    throw new Error(`unexpected token: ${JSON.stringify(t)}`);
  };
  try {
    const result = parseTernary();
    if (pos !== tokens.length) {
      throw new Error("trailing tokens");
    }
    return result;
  } catch {
    return;
  }
}

// public/scene-manager/event-queue.ts
var DEFAULT_MAX_IN_FLIGHT = 1;

class InstanceQueue {
  config;
  deliver;
  onTimeout;
  pending = [];
  inFlight = new Map;
  constructor(config, deliver, onTimeout) {
    this.config = config;
    this.deliver = deliver;
    this.onTimeout = onTimeout;
  }
  enqueue(item) {
    const priority = this.priorityOf(item);
    const entry = { ...item, priority };
    if (!this.config.priorityExpr) {
      this.pending.push(entry);
    } else {
      let i = 0;
      while (i < this.pending.length && this.pending[i].priority >= priority) {
        i += 1;
      }
      this.pending.splice(i, 0, entry);
    }
    this.pump();
  }
  complete(eventId) {
    const timer = this.inFlight.get(eventId);
    if (timer) {
      clearTimeout(timer);
    }
    if (this.inFlight.delete(eventId)) {
      this.pump();
    }
  }
  size() {
    return this.pending.length + this.inFlight.size;
  }
  priorityOf(item) {
    if (!this.config.priorityExpr) {
      return 0;
    }
    const result = evaluateExpression(this.config.priorityExpr, {
      type: item.type,
      key: item.key,
      value: item.value
    });
    return typeof result === "number" && Number.isFinite(result) ? result : 0;
  }
  pump() {
    const maxInFlight = this.config.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    while (this.inFlight.size < maxInFlight && this.pending.length > 0) {
      const item = this.pending.shift();
      const delivered = this.deliver(item);
      if (!delivered) {
        continue;
      }
      let timer = null;
      if (this.config.retryTimeoutMs) {
        timer = setTimeout(() => {
          this.inFlight.delete(item.eventId);
          this.onTimeout(item.eventId);
          this.pump();
        }, this.config.retryTimeoutMs);
      }
      this.inFlight.set(item.eventId, timer);
    }
  }
}

class EventQueueManager {
  queues = new Map;
  subToInstance = new Map;
  register(subId, instanceId, config, deliver, onTimeout) {
    this.subToInstance.set(subId, instanceId);
    this.queues.set(instanceId, new InstanceQueue(config ?? {}, deliver, onTimeout));
  }
  unregister(subId) {
    const instanceId = this.subToInstance.get(subId);
    this.subToInstance.delete(subId);
    if (instanceId) {
      this.queues.delete(instanceId);
    }
  }
  enqueue(instanceId, item) {
    const queue = this.queues.get(instanceId);
    if (!queue) {
      return false;
    }
    queue.enqueue(item);
    return true;
  }
  complete(subId, eventId) {
    const instanceId = this.subToInstance.get(subId);
    if (!instanceId) {
      return;
    }
    this.queues.get(instanceId)?.complete(eventId);
  }
}

// public/scene-manager/event-source.ts
function parseSseChunk(rawEvent) {
  const dataLine = rawEvent.split(`
`).find((line) => line.startsWith("data:"));
  if (!dataLine) {
    return null;
  }
  const json = dataLine.slice("data:".length).trim();
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.eventId === "string" && typeof parsed.instanceId === "string" && typeof parsed.type === "string" && typeof parsed.key === "string") {
      return { eventId: parsed.eventId, instanceId: parsed.instanceId, type: parsed.type, key: parsed.key, value: parsed.value };
    }
  } catch {}
  return null;
}

class SceneEventSource {
  url;
  fetchFn;
  reconnectBaseMs;
  reconnectMaxMs;
  sink = null;
  stopped = true;
  reconnectAttempt = 0;
  reconnectTimer = null;
  abortController = null;
  constructor(options) {
    this.url = options.url;
    this.fetchFn = options.fetchFn ?? fetch;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 1e4;
  }
  start(sink) {
    this.sink = sink;
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.connect();
  }
  stop() {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.abortController?.abort();
    this.abortController = null;
  }
  async connect() {
    if (this.stopped) {
      return;
    }
    const controller = new AbortController;
    this.abortController = controller;
    let response;
    try {
      response = await this.fetchFn(this.url, {
        credentials: "same-origin",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal
      });
    } catch (err) {
      if (!this.stopped) {
        this.onDisconnected();
        this.scheduleReconnect();
      }
      return;
    }
    if (!response.ok || !response.body) {
      this.onDisconnected();
      this.scheduleReconnect();
      return;
    }
    this.reconnectAttempt = 0;
    this.sink?.onConnectionChange(true);
    const reader = response.body.getReader();
    const decoder = new TextDecoder;
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf(`

`)) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const frame = parseSseChunk(rawEvent);
          if (frame) {
            this.sink?.onFrame(frame);
          }
        }
      }
    } catch {}
    if (this.stopped) {
      return;
    }
    this.onDisconnected();
    this.scheduleReconnect();
  }
  onDisconnected() {
    this.sink?.onConnectionChange(false);
  }
  scheduleReconnect() {
    if (this.stopped) {
      return;
    }
    const attempt = this.reconnectAttempt;
    this.reconnectAttempt += 1;
    const delay = Math.min(this.reconnectBaseMs * 2 ** attempt, this.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

// public/scene-manager/index.ts
var REFRESH_INTERVAL_MS = 50000;
var ACK_BATCH_WINDOW_MS = 250;
function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function setConnectedSignal(connected) {
  const banner = document.getElementById("disconnected-banner");
  banner?.classList.toggle("visible", !connected);
  try {
    document.dispatchEvent(new CustomEvent("datastar-signal-patch", { detail: { connected } }));
  } catch {}
}

class AckBatcher {
  endpoint;
  pending = new Map;
  timer = null;
  constructor(endpoint) {
    this.endpoint = endpoint;
  }
  add(eventId, instanceId) {
    let set = this.pending.get(eventId);
    if (!set) {
      set = new Set;
      this.pending.set(eventId, set);
    }
    set.add(instanceId);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), ACK_BATCH_WINDOW_MS);
    }
  }
  flush() {
    this.timer = null;
    const batch = this.pending;
    this.pending.clear();
    for (const [eventId, instanceIds] of batch) {
      fetch(this.endpoint(eventId), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceIds: [...instanceIds] })
      }).catch(() => {});
    }
  }
}
function main() {
  const sceneData = window.__WOOFX3_SCENE__?.scene;
  const container = document.getElementById("widgets");
  if (!sceneData || !container) {
    return;
  }
  const sceneId = sceneData.id;
  const sceneBase = `/scene/${encodeURIComponent(sceneId)}`;
  const bridgesByInstance = new Map;
  const queueManager = new EventQueueManager;
  const deliveredBatcher = new AckBatcher((eventId) => `${sceneBase}/events/${encodeURIComponent(eventId)}/delivered`);
  const completedBatcher = new AckBatcher((eventId) => `${sceneBase}/events/${encodeURIComponent(eventId)}/completed`);
  function postStatus(instanceId, report) {
    fetch(`${sceneBase}/widget/${encodeURIComponent(instanceId)}/status`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moduleId: report.moduleId,
        widgetCanonicalId: report.widgetCanonicalId,
        key: report.key,
        value: report.value,
        ts: report.ts
      })
    }).catch(() => {});
  }
  for (const instance of sceneData.widgets) {
    const iframe = document.createElement("iframe");
    iframe.className = "widget-frame";
    iframe.style.left = `${instance.position.x}px`;
    iframe.style.top = `${instance.position.y}px`;
    iframe.style.width = `${instance.position.width}px`;
    iframe.style.height = `${instance.position.height}px`;
    iframe.setAttribute("sandbox", "allow-scripts");
    const nonce = generateNonce();
    let currentSubId = null;
    const callbacks = {
      onStorageGet: () => null,
      onStorageSubscribe: () => {},
      onStorageUnsubscribe: () => {},
      onStatusReport: (report) => postStatus(instance.id, report),
      onEventsSubscribe: (subId, queue) => {
        currentSubId = subId;
        queueManager.register(subId, instance.id, queue, (item) => bridge.sendEvent(subId, toWidgetEvent(item)), () => {});
      },
      onEventsUnsubscribe: (subId) => {
        queueManager.unregister(subId);
        if (currentSubId === subId) {
          currentSubId = null;
        }
      },
      onEventComplete: (subId, eventId) => {
        queueManager.complete(subId, eventId);
        completedBatcher.add(eventId, instance.id);
      },
      onDispose: () => {
        if (currentSubId) {
          queueManager.unregister(currentSubId);
          currentSubId = null;
        }
      }
    };
    const bridge = new WidgetBridge(instance.id, nonce, callbacks);
    iframe.addEventListener("load", () => bridge.onFrameLoad());
    iframe.src = `${instance.frameUrl}?nonce=${encodeURIComponent(nonce)}`;
    bridgesByInstance.set(instance.id, bridge);
    container.appendChild(iframe);
    bridge.attach(iframe);
  }
  window.addEventListener("message", (event) => {
    for (const bridge of bridgesByInstance.values()) {
      bridge.handleMessage(event);
    }
  });
  function toWidgetEvent(item) {
    return {
      type: item.type,
      source: "scene-manager",
      time: new Date().toISOString(),
      data: item.value,
      eventId: item.eventId
    };
  }
  const eventSource = new SceneEventSource({ url: new URL(`${sceneBase}/events`, location.href).toString() });
  eventSource.start({
    onFrame: (frame) => {
      deliveredBatcher.add(frame.eventId, frame.instanceId);
      queueManager.enqueue(frame.instanceId, { eventId: frame.eventId, type: frame.type, key: frame.key, value: frame.value });
    },
    onConnectionChange: (connected) => setConnectedSignal(connected)
  });
  let refreshFailing = false;
  setInterval(() => {
    fetch(`${sceneBase}/session/refresh`, { method: "POST", credentials: "same-origin" }).then((resp) => {
      if (!resp.ok) {
        throw new Error(`refresh failed: ${resp.status}`);
      }
      if (refreshFailing) {
        refreshFailing = false;
        setConnectedSignal(true);
      }
    }).catch(() => {
      refreshFailing = true;
      setConnectedSignal(false);
    });
  }, REFRESH_INTERVAL_MS);
}
main();
