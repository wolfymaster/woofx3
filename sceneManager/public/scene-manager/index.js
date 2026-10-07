// public/scene-manager/alert-timeline.ts
var UNTIMED_ALERT_MS = 5000;
var SUBSCRIBE_TIMEOUT_MS = 1e4;
var MAX_ALERT_MS = 5 * 60000;

class AlertTimeline {
  startedAt;
  widgets = new Map;
  anyTimed = false;
  constructor(widgetIds, startedAt) {
    this.startedAt = startedAt;
    for (const id of widgetIds) {
      this.widgets.set(id, "loading");
    }
  }
  subscribed(widgetId, timed) {
    if (this.widgets.get(widgetId) !== "loading") {
      return;
    }
    this.widgets.set(widgetId, timed ? "playing" : "untimed");
    if (timed) {
      this.anyTimed = true;
    }
  }
  completed(widgetId) {
    if (this.widgets.get(widgetId) === "playing") {
      this.widgets.set(widgetId, "done");
    }
  }
  isOver(now) {
    const elapsed = now - this.startedAt;
    if (elapsed >= MAX_ALERT_MS) {
      return true;
    }
    for (const state of this.widgets.values()) {
      if (state === "playing") {
        return false;
      }
      if (state === "loading" && elapsed < SUBSCRIBE_TIMEOUT_MS) {
        return false;
      }
    }
    return this.anyTimed || elapsed >= UNTIMED_ALERT_MS;
  }
}
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
  settingsSubscribed = false;
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
    this.settingsSubscribed = false;
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
      case "media.get": {
        if (!this.initialized) {
          return;
        }
        const id = typeof msg.id === "string" ? msg.id : "";
        const url = typeof msg.url === "string" ? msg.url : "";
        if (!id) {
          return;
        }
        this.callbacks.onMediaGet(url).catch(() => null).then((blob) => this.post({ type: "media.value", id, url, blob }));
        return;
      }
      case "settings.subscribe": {
        if (!this.initialized) {
          return;
        }
        this.settingsSubscribed = true;
        return;
      }
      case "settings.unsubscribe": {
        this.settingsSubscribed = false;
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
      capabilities: ["storage", "events", "status", "settings", "media"]
    });
  }
  sendReject(reason) {
    this.post({
      type: "init.reject",
      reason,
      supportedVersions: [PROTOCOL_VERSION]
    });
  }
  sendStorageValue(key, value) {
    if (this.moduleId) {
      this.sendStorageChanged(this.moduleId, key, value);
    }
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
  acceptsSettings() {
    return this.initialized && this.settingsSubscribed;
  }
  sendSettings(settings) {
    if (!this.acceptsSettings()) {
      return false;
    }
    this.post({ type: "settings.changed", settings });
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
    this.settingsSubscribed = false;
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
function createFrameLoadHandler(bridge) {
  let loadCount = 0;
  return () => {
    loadCount += 1;
    if (loadCount > 1) {
      bridge.onFrameLoad();
    }
  };
}

// public/scene-manager/alert-widget.ts
var TICK_MS = 250;

class AlertWidget {
  opts;
  playing = new Map;
  constructor(opts) {
    this.opts = opts;
  }
  stop(eventId) {
    this.playing.get(eventId)?.();
  }
  dispose() {
    for (const [eventId, tearDown] of [...this.playing]) {
      tearDown();
      this.opts.onFinished(eventId);
    }
  }
  play(item) {
    const delivery = parseDelivery(item.value);
    if (!delivery) {
      console.warn("[scene-manager] malformed alert delivery; skipping", { eventId: item.eventId });
      setTimeout(() => this.opts.onFinished(item.eventId), 0);
      return true;
    }
    this.run(item.eventId, delivery);
    return true;
  }
  run(eventId, delivery) {
    const { element, sceneBase, bridges, media } = this.opts;
    const { layout } = delivery;
    media.prefetch(delivery.media);
    const stage = document.createElement("div");
    stage.className = "alert-stage";
    stage.style.width = `${layout.width}px`;
    stage.style.height = `${layout.height}px`;
    const scale = Math.min(element.clientWidth / layout.width, element.clientHeight / layout.height);
    const offsetX = (element.clientWidth - layout.width * scale) / 2;
    const offsetY = (element.clientHeight - layout.height * scale) / 2;
    stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    element.appendChild(stage);
    const timeline = new AlertTimeline(layout.widgets.map((widget) => widget.id), Date.now());
    const alertEvent = {
      type: "alert",
      source: "scene-manager",
      time: new Date().toISOString(),
      data: delivery.event,
      eventId
    };
    const children = [];
    for (const widget of layout.widgets) {
      const instanceId = `${eventId}.${widget.id}`;
      const nonce = this.opts.generateNonce();
      const iframe = document.createElement("iframe");
      iframe.className = "widget-frame";
      iframe.style.left = `${widget.position.x}px`;
      iframe.style.top = `${widget.position.y}px`;
      iframe.style.width = `${widget.position.width}px`;
      iframe.style.height = `${widget.position.height}px`;
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.setAttribute("allow", "autoplay");
      const bridge = new WidgetBridge(instanceId, nonce, {
        onStorageGet: () => null,
        onStorageSubscribe: () => {},
        onStorageUnsubscribe: () => {},
        onStatusReport: (report) => this.opts.postStatus(instanceId, report),
        onEventsSubscribe: (subId, queue) => {
          timeline.subscribed(widget.id, queue?.autoComplete === false);
          bridge.sendEvent(subId, alertEvent);
        },
        onEventsUnsubscribe: () => {},
        onEventComplete: () => timeline.completed(widget.id),
        onMediaGet: (url) => media.load(url),
        onDispose: () => {}
      });
      iframe.addEventListener("load", createFrameLoadHandler(bridge));
      iframe.src = `${sceneBase}/alert/${encodeURIComponent(eventId)}/widget/${encodeURIComponent(widget.id)}` + `?nonce=${encodeURIComponent(nonce)}`;
      bridges.add(bridge);
      stage.appendChild(iframe);
      bridge.attach(iframe);
      children.push(bridge);
    }
    const tearDown = () => {
      clearInterval(timer);
      this.playing.delete(eventId);
      for (const bridge of children) {
        bridge.dispose();
        bridge.detach();
        bridges.delete(bridge);
      }
      stage.remove();
    };
    const timer = setInterval(() => {
      if (!timeline.isOver(Date.now())) {
        return;
      }
      tearDown();
      this.opts.onFinished(eventId);
    }, TICK_MS);
    this.playing.set(eventId, tearDown);
  }
}
function parseDelivery(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { layout, event, media } = value;
  if (!layout || !(layout.width > 0) || !(layout.height > 0) || !Array.isArray(layout.widgets)) {
    return null;
  }
  const mediaKeys = Array.isArray(media) ? media.filter((key) => typeof key === "string") : [];
  return { layout, event: event ?? null, media: mediaKeys };
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
var REMEMBERED_FINISHED_EVENTS = 256;

class InstanceQueue {
  config;
  deliver;
  onTimeout;
  onCancel;
  pending = [];
  inFlight = new Map;
  finished = new Set;
  constructor(config, deliver, onTimeout, onCancel) {
    this.config = config;
    this.deliver = deliver;
    this.onTimeout = onTimeout;
    this.onCancel = onCancel;
  }
  enqueue(item) {
    if (this.inFlight.has(item.eventId) || this.finished.has(item.eventId) || this.pending.some((pending) => pending.eventId === item.eventId)) {
      return;
    }
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
      this.rememberFinished(eventId);
      this.pump();
    }
  }
  cancel(eventIds) {
    const cancelled = new Set(eventIds);
    for (let i = this.pending.length - 1;i >= 0; i -= 1) {
      if (cancelled.has(this.pending[i].eventId)) {
        this.pending.splice(i, 1);
      }
    }
    for (const eventId of cancelled) {
      if (this.inFlight.has(eventId)) {
        const timer = this.inFlight.get(eventId);
        if (timer) {
          clearTimeout(timer);
        }
        this.inFlight.delete(eventId);
        this.onCancel(eventId);
      }
      this.rememberFinished(eventId);
    }
    this.pump();
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
          this.rememberFinished(item.eventId);
          this.onTimeout(item.eventId);
          this.pump();
        }, this.config.retryTimeoutMs);
      }
      this.inFlight.set(item.eventId, timer);
    }
  }
  rememberFinished(eventId) {
    this.finished.add(eventId);
    if (this.finished.size > REMEMBERED_FINISHED_EVENTS) {
      const oldest = this.finished.values().next().value;
      if (oldest !== undefined) {
        this.finished.delete(oldest);
      }
    }
  }
}

class EventQueueManager {
  queues = new Map;
  subToInstance = new Map;
  register(subId, instanceId, config, deliver, onTimeout, onCancel = () => {}) {
    this.subToInstance.set(subId, instanceId);
    this.queues.set(instanceId, new InstanceQueue(config ?? {}, deliver, onTimeout, onCancel));
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
  cancel(instanceId, eventIds) {
    this.queues.get(instanceId)?.cancel(eventIds);
  }
  complete(subId, eventId) {
    const instanceId = this.subToInstance.get(subId);
    if (!instanceId) {
      return;
    }
    this.queues.get(instanceId)?.complete(eventId);
  }
}
function toWidgetEvent(item) {
  return {
    type: item.type,
    source: "scene-manager",
    time: new Date().toISOString(),
    data: item.value,
    eventId: item.eventId
  };
}

// public/scene-manager/ack-batcher.ts
var ACK_BATCH_WINDOW_MS = 250;

class AckBatcher {
  endpoint;
  pending = new Map;
  timer = null;
  windowMs;
  fetchFn;
  constructor(endpoint, options = {}) {
    this.endpoint = endpoint;
    this.windowMs = options.windowMs ?? ACK_BATCH_WINDOW_MS;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  }
  add(eventId, instanceId) {
    let set = this.pending.get(eventId);
    if (!set) {
      set = new Set;
      this.pending.set(eventId, set);
    }
    set.add(instanceId);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.windowMs);
    }
  }
  flush() {
    this.timer = null;
    const batch = [...this.pending];
    this.pending.clear();
    for (const [eventId, instanceIds] of batch) {
      this.fetchFn(this.endpoint(eventId), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceIds: [...instanceIds] })
      }).catch(() => {});
    }
  }
}

// public/scene-manager/reconnect-coordinator.ts
var ALWAYS_PROBE = {
  shouldProbe: () => true,
  onDisconnected: () => {},
  onConnected: () => {},
  onPeerConnected: () => {},
  requestPeerReload: () => {},
  onPeerReload: () => {},
  stop: () => {}
};
var HEARTBEAT_MS = 2000;
var PEER_TTL_MS = 5500;
var CHANNEL_NAME = "woofx3-scene-manager-reconnect";
function randomPeerId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

class BroadcastReconnectCoordinator {
  channel;
  peerId;
  now;
  heartbeatMs;
  peerTtlMs;
  peersLastSeen = new Map;
  heartbeatTimer = null;
  peerConnectedHandler = null;
  peerReloadHandler = null;
  stopped = false;
  constructor(options) {
    this.channel = options.channel;
    this.peerId = options.peerId ?? randomPeerId();
    this.now = options.now ?? (() => Date.now());
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    this.peerTtlMs = options.peerTtlMs ?? PEER_TTL_MS;
    this.channel.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }
  handleMessage(data) {
    const message = data;
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.t === "alive" && typeof message.id === "string") {
      this.peersLastSeen.set(message.id, this.now());
      return;
    }
    if (message.t === "up") {
      this.peerConnectedHandler?.();
      return;
    }
    if (message.t === "reload") {
      this.peerReloadHandler?.();
    }
  }
  shouldProbe() {
    if (this.stopped) {
      return false;
    }
    const cutoff = this.now() - this.peerTtlMs;
    for (const [id, lastSeen] of this.peersLastSeen) {
      if (lastSeen < cutoff) {
        this.peersLastSeen.delete(id);
      }
    }
    for (const id of this.peersLastSeen.keys()) {
      if (id < this.peerId) {
        return false;
      }
    }
    return true;
  }
  onDisconnected() {
    if (this.stopped || this.heartbeatTimer !== null) {
      return;
    }
    this.announceAlive();
    this.heartbeatTimer = setInterval(() => {
      this.announceAlive();
    }, this.heartbeatMs);
  }
  onConnected() {
    this.stopHeartbeat();
    this.post({ t: "up" });
  }
  onPeerConnected(handler) {
    this.peerConnectedHandler = handler;
  }
  requestPeerReload() {
    this.post({ t: "reload" });
  }
  onPeerReload(handler) {
    this.peerReloadHandler = handler;
  }
  stop() {
    this.stopped = true;
    this.stopHeartbeat();
    this.peerConnectedHandler = null;
    this.peerReloadHandler = null;
    this.channel.onmessage = null;
    this.channel.close();
  }
  announceAlive() {
    this.post({ t: "alive", id: this.peerId });
  }
  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  post(message) {
    try {
      this.channel.postMessage(message);
    } catch {}
  }
}
function adaptBroadcastChannel(channel) {
  let handler = null;
  return {
    postMessage: (message) => channel.postMessage(message),
    close: () => channel.close(),
    get onmessage() {
      return handler;
    },
    set onmessage(next) {
      handler = next;
      channel.onmessage = next ? (event) => next({ data: event.data }) : null;
    }
  };
}
function createReconnectCoordinator() {
  if (typeof BroadcastChannel === "undefined") {
    return ALWAYS_PROBE;
  }
  try {
    return new BroadcastReconnectCoordinator({ channel: adaptBroadcastChannel(new BroadcastChannel(CHANNEL_NAME)) });
  } catch {
    return ALWAYS_PROBE;
  }
}

// public/scene-manager/event-source.ts
var SESSION_REJECTED_STATUSES = new Set([401, 403]);
function parseSseChunk(rawEvent) {
  const lines = rawEvent.split(`
`);
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLine = lines.find((line) => line.startsWith("data:"));
  if (!dataLine) {
    return null;
  }
  const json = dataLine.slice("data:".length).trim();
  if (!json) {
    return null;
  }
  const eventName = eventLine ? eventLine.slice("event:".length).trim() : "";
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  if (eventName === "hello") {
    return typeof parsed.bootId === "string" && parsed.bootId.length > 0 ? { kind: "hello", bootId: parsed.bootId } : null;
  }
  if (eventName === "scene-updated") {
    return { kind: "scene-updated" };
  }
  if (eventName === "cancel") {
    const { instanceId, eventIds } = parsed;
    return typeof instanceId === "string" && Array.isArray(eventIds) && eventIds.every((id) => typeof id === "string") ? { kind: "cancel", frame: { instanceId, eventIds } } : null;
  }
  if (eventName === "module-state") {
    return typeof parsed.moduleId === "string" && typeof parsed.key === "string" ? { kind: "module-state", frame: { moduleId: parsed.moduleId, key: parsed.key, value: parsed.value ?? null } } : null;
  }
  if (typeof parsed.eventId === "string" && typeof parsed.instanceId === "string" && typeof parsed.type === "string" && typeof parsed.key === "string") {
    return {
      kind: "delivery",
      frame: {
        eventId: parsed.eventId,
        instanceId: parsed.instanceId,
        type: parsed.type,
        key: parsed.key,
        value: parsed.value
      }
    };
  }
  return null;
}

class SceneEventSource {
  url;
  fetchFn;
  reconnectBaseMs;
  reconnectMaxMs;
  coordinator;
  random;
  sink = null;
  stopped = true;
  everConnected = false;
  reconnectAttempt = 0;
  reconnectTimer = null;
  abortController = null;
  constructor(options) {
    this.url = options.url;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 5000;
    this.coordinator = options.coordinator ?? ALWAYS_PROBE;
    this.random = options.random ?? Math.random;
  }
  start(sink) {
    this.sink = sink;
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.coordinator.onPeerConnected(() => {
      this.wakeNow();
    });
    this.connect();
  }
  stop() {
    this.stopped = true;
    this.clearTimer();
    this.abortController?.abort();
    this.abortController = null;
    this.coordinator.stop();
  }
  wakeNow() {
    if (this.stopped || this.reconnectTimer === null) {
      return;
    }
    this.clearTimer();
    this.reconnectAttempt = 0;
    this.connect();
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
    } catch {
      if (!this.stopped) {
        this.onDisconnected();
        this.scheduleReconnect();
      }
      return;
    }
    if (!response.ok || !response.body) {
      if (SESSION_REJECTED_STATUSES.has(response.status) && this.everConnected) {
        this.onDisconnected();
        this.sink?.onSessionExpired?.();
        return;
      }
      this.onDisconnected();
      this.scheduleReconnect();
      return;
    }
    this.everConnected = true;
    this.reconnectAttempt = 0;
    this.coordinator.onConnected();
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
          const parsed = parseSseChunk(rawEvent);
          if (!parsed) {
            continue;
          }
          if (parsed.kind === "hello") {
            this.sink?.onHello?.(parsed.bootId);
          } else if (parsed.kind === "module-state") {
            this.sink?.onModuleState?.(parsed.frame);
          } else if (parsed.kind === "scene-updated") {
            this.sink?.onSceneUpdated?.();
          } else if (parsed.kind === "cancel") {
            this.sink?.onCancel?.(parsed.frame);
          } else {
            this.sink?.onFrame(parsed.frame);
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
    this.coordinator.onDisconnected();
    this.sink?.onConnectionChange(false);
  }
  clearTimer() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  nextDelayMs() {
    const capped = Math.min(this.reconnectBaseMs * 2 ** this.reconnectAttempt, this.reconnectMaxMs);
    return capped / 2 + this.random() * (capped / 2);
  }
  scheduleReconnect() {
    if (this.stopped) {
      return;
    }
    const delay = this.nextDelayMs();
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.coordinator.shouldProbe()) {
        this.scheduleReconnect();
        return;
      }
      this.connect();
    }, delay);
  }
}

// src/scene/media-keys.ts
var MEDIA_KEY_PATTERN = /^(user|modules)\/[^?#]+$/;
var ASSET_URL_TOKEN = /^\$\{woofx3_asset_url:([^}]+)\}$/;
var ASSET_PATH_PREFIX = "/assets/";
function mediaKeyOf(value) {
  const token = ASSET_URL_TOKEN.exec(value);
  const key = token ? token[1] : keyOfAssetUrl(value);
  if (key === null || !isMediaKey(key)) {
    return null;
  }
  return key;
}
function isMediaKey(key) {
  if (!MEDIA_KEY_PATTERN.test(key)) {
    return false;
  }
  const segments = key.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  return !(segments[0] === "modules" && (segments[3] === "widgets" || segments[3] === "themes"));
}
function keyOfAssetUrl(value) {
  if (!value.includes(ASSET_PATH_PREFIX)) {
    return null;
  }
  let pathname;
  try {
    pathname = new URL(value).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(ASSET_PATH_PREFIX)) {
    return null;
  }
  try {
    return pathname.slice(ASSET_PATH_PREFIX.length).split("/").map((segment) => decodeURIComponent(segment)).join("/");
  } catch {
    return null;
  }
}

// public/scene-manager/media-cache.ts
var MAX_MEDIA_BYTES = 64 * 1024 * 1024;
var MAX_MEMORY_BYTES = 256 * 1024 * 1024;
var PREFETCH_CONCURRENCY = 3;

class MediaCache {
  opts;
  memory = new Map;
  memoryBytes = 0;
  inFlight = new Map;
  fetchFn;
  cacheName;
  cacheStorage;
  constructor(opts) {
    this.opts = opts;
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.cacheName = `woofx3-media:${opts.sceneId}`;
    this.cacheStorage = opts.cacheStorage === undefined ? defaultCacheStorage() : opts.cacheStorage;
  }
  async load(url) {
    const key = mediaKeyOf(url);
    return key === null ? null : this.get(key);
  }
  get(key) {
    if (!isMediaKey(key)) {
      return Promise.resolve(null);
    }
    const held = this.memory.get(key);
    if (held !== undefined) {
      this.memory.delete(key);
      this.memory.set(key, held);
      return Promise.resolve(held);
    }
    const pending = this.inFlight.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const loading = this.fetchKey(key).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, loading);
    return loading;
  }
  async prefetch(keys) {
    const queue = keys.filter((key) => !this.memory.has(key));
    const workers = Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, async () => {
      for (let key = queue.shift();key !== undefined; key = queue.shift()) {
        await this.get(key);
      }
    });
    await Promise.all(workers);
  }
  async prune(keep) {
    if (this.cacheStorage === null) {
      return;
    }
    const kept = new Set(keep.map((key) => this.mediaUrl(key)));
    try {
      const cache = await this.cacheStorage.open(this.cacheName);
      for (const request of await cache.keys()) {
        if (!kept.has(request.url)) {
          await cache.delete(request);
        }
      }
    } catch (err) {
      this.warn("media cache prune failed", { error: errorMessage(err) });
    }
  }
  async fetchKey(key) {
    const url = this.mediaUrl(key);
    const persisted = await this.readPersisted(url);
    if (persisted !== null) {
      this.remember(key, persisted);
      return persisted;
    }
    let response;
    try {
      response = await this.fetchFn(url, { credentials: "same-origin" });
    } catch (err) {
      this.warn("media fetch failed", { key, error: errorMessage(err) });
      return null;
    }
    if (!response.ok) {
      if (response.status !== 413) {
        this.warn("media fetch refused", { key, status: response.status });
      }
      await response.body?.cancel();
      return null;
    }
    let blob;
    try {
      blob = await response.blob();
    } catch (err) {
      this.warn("media download failed", { key, error: errorMessage(err) });
      return null;
    }
    if (blob.size > MAX_MEDIA_BYTES) {
      return null;
    }
    this.remember(key, blob);
    await this.persist(url, blob);
    return blob;
  }
  remember(key, blob) {
    this.memory.set(key, blob);
    this.memoryBytes += blob.size;
    for (const [oldest, held] of this.memory) {
      if (this.memoryBytes <= (this.opts.maxMemoryBytes ?? MAX_MEMORY_BYTES) || oldest === key) {
        break;
      }
      this.memory.delete(oldest);
      this.memoryBytes -= held.size;
    }
  }
  async readPersisted(url) {
    if (this.cacheStorage === null) {
      return null;
    }
    try {
      const cache = await this.cacheStorage.open(this.cacheName);
      const hit = await cache.match(url);
      return hit ? await hit.blob() : null;
    } catch {
      return null;
    }
  }
  async persist(url, blob) {
    if (this.cacheStorage === null) {
      return;
    }
    try {
      const cache = await this.cacheStorage.open(this.cacheName);
      await cache.put(url, new Response(blob, { headers: { "Content-Type": blob.type } }));
    } catch (err) {
      this.warn("media cache write failed", { error: errorMessage(err) });
    }
  }
  mediaUrl(key) {
    const path = `${this.opts.sceneBase}/media/${key.split("/").map(encodeURIComponent).join("/")}`;
    return new URL(path, this.opts.pageUrl ?? location.href).toString();
  }
  warn(message, detail) {
    this.opts.warn?.(`[scene-manager] ${message}`, detail);
  }
}
function defaultCacheStorage() {
  return typeof caches === "undefined" ? null : caches;
}
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

// public/scene-manager/module-state.ts
class ModuleStateCache {
  fetchValue;
  entries = new Map;
  constructor(fetchValue) {
    this.fetchValue = fetchValue;
  }
  peek(moduleId, key) {
    const entry = this.entries.get(entryKey(moduleId, key));
    return entry?.known ? entry.value : null;
  }
  watch(moduleId, key, target) {
    const entry = this.entry(moduleId, key);
    entry.targets.set(target, (entry.targets.get(target) ?? 0) + 1);
    this.load(entry);
  }
  unwatch(moduleId, key, target) {
    const entry = this.entries.get(entryKey(moduleId, key));
    const count = entry?.targets.get(target);
    if (!entry || count === undefined) {
      return;
    }
    if (count > 1) {
      entry.targets.set(target, count - 1);
    } else {
      entry.targets.delete(target);
    }
  }
  unwatchAll(target) {
    for (const entry of this.entries.values()) {
      entry.targets.delete(target);
    }
  }
  apply(moduleId, key, value) {
    const entry = this.entries.get(entryKey(moduleId, key));
    if (!entry) {
      return;
    }
    entry.generation += 1;
    this.settle(entry, value);
  }
  refresh() {
    for (const entry of this.entries.values()) {
      if (entry.targets.size > 0) {
        this.load(entry);
      }
    }
  }
  entry(moduleId, key) {
    const id = entryKey(moduleId, key);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { moduleId, key, known: false, value: null, generation: 0, loading: false, targets: new Map };
      this.entries.set(id, entry);
    }
    return entry;
  }
  async load(entry) {
    if (entry.loading) {
      return;
    }
    const via = entry.targets.keys().next().value;
    if (via === undefined) {
      return;
    }
    entry.loading = true;
    const generation = entry.generation;
    let value;
    try {
      value = await this.fetchValue(via.instanceId, entry.key);
    } catch {
      if (entry.known && entry.generation === generation) {
        this.settle(entry, entry.value);
      }
      return;
    } finally {
      entry.loading = false;
    }
    if (entry.generation !== generation) {
      return;
    }
    this.settle(entry, value);
  }
  settle(entry, value) {
    entry.known = true;
    entry.value = value;
    for (const target of entry.targets.keys()) {
      target.sendStorageValue(entry.key, value);
    }
  }
}
function entryKey(moduleId, key) {
  return `${moduleId}\x00${key}`;
}

// public/scene-manager/connection-status.ts
class ConnectionStatus {
  render;
  unhealthy = new Set(["stream"]);
  lastRendered = null;
  constructor(render) {
    this.render = render;
  }
  set(input, healthy) {
    if (healthy) {
      this.unhealthy.delete(input);
    } else {
      this.unhealthy.add(input);
    }
    const connected = this.unhealthy.size === 0;
    if (connected === this.lastRendered) {
      return;
    }
    this.lastRendered = connected;
    this.render(connected);
  }
  get connected() {
    return this.unhealthy.size === 0;
  }
}

// public/scene-manager/scene-update.ts
function planSceneUpdate(current, next) {
  const currentById = new Map(current.map((placement) => [placement.id, placement]));
  const nextIds = new Set(next.map((placement) => placement.id));
  const plan = {
    remove: current.filter((placement) => !nextIds.has(placement.id)).map((placement) => placement.id),
    mount: [],
    place: [],
    order: next.map((placement) => placement.id)
  };
  for (const placement of next) {
    const existing = currentById.get(placement.id);
    if (existing && sameFrame(existing, placement)) {
      plan.place.push(placement);
      continue;
    }
    if (existing) {
      plan.remove.push(placement.id);
    }
    plan.mount.push(placement);
  }
  return plan;
}
function sameFrame(a, b) {
  return a.widgetCanonicalId === b.widgetCanonicalId && a.moduleId === b.moduleId && a.hostsSurface === b.hostsSurface && sameValue(a.settings, b.settings);
}
var THEME_SETTING_ID = "theme";
function themeOf(settings) {
  const value = settings[THEME_SETTING_ID];
  return typeof value === "string" ? value.trim() : "";
}
function canChangeSettingsLive(current, next) {
  return themeOf(current) === themeOf(next);
}
function sameValue(a, b) {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const aRecord = a;
  const bRecord = b;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) {
    return false;
  }
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue(aRecord[key], bRecord[key]));
}
function parseSceneConfig(body) {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const scene = body.scene;
  if (typeof scene !== "object" || scene === null) {
    return null;
  }
  const s = scene;
  if (typeof s.id !== "string" || typeof s.layout !== "object" || s.layout === null || !Array.isArray(s.widgets)) {
    return null;
  }
  return {
    id: s.id,
    name: typeof s.name === "string" ? s.name : "",
    layout: s.layout,
    widgets: s.widgets
  };
}

// public/scene-manager/preview-layout.ts
var PREVIEW_LAYOUT_MESSAGE = "woofx3.scene-preview.layout";
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function parseWidget(raw) {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const w = raw;
  if (typeof w.id !== "string" || w.id.length === 0) {
    return null;
  }
  if (!isFiniteNumber(w.x) || !isFiniteNumber(w.y) || !isFiniteNumber(w.width) || !isFiniteNumber(w.height)) {
    return null;
  }
  return { id: w.id, x: w.x, y: w.y, width: w.width, height: w.height };
}
function parsePreviewLayout(data) {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const message = data;
  if (message.type !== PREVIEW_LAYOUT_MESSAGE || !Array.isArray(message.widgets)) {
    return null;
  }
  const widgets = [];
  for (const raw of message.widgets) {
    const widget = parseWidget(raw);
    if (widget) {
      widgets.push(widget);
    }
  }
  return widgets;
}
function parsePreviewPlacements(data) {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const message = data;
  if (message.type !== PREVIEW_LAYOUT_MESSAGE || !Array.isArray(message.placements)) {
    return null;
  }
  return message.placements;
}
function draftFrameKey(placements, liveSettings = () => false) {
  return JSON.stringify(placements.map((raw) => {
    const placement = typeof raw === "object" && raw !== null ? raw : {};
    const live = typeof placement.id === "string" && liveSettings(placement.id);
    const settings = live ? themeOf(settingsOf(placement)) : placement.settings;
    return [placement.id, placement.widgetCanonicalId, settings];
  }));
}
function settingsOf(placement) {
  const settings = placement.settings;
  return typeof settings === "object" && settings !== null && !Array.isArray(settings) ? settings : {};
}
function applyPreviewLayout(elements, layout) {
  const byId = new Map(layout.map((widget) => [widget.id, widget]));
  for (const [id, element] of elements) {
    const widget = byId.get(id);
    if (!widget) {
      element.style.display = "none";
      continue;
    }
    element.style.display = "";
    element.style.left = `${widget.x}px`;
    element.style.top = `${widget.y}px`;
    element.style.width = `${widget.width}px`;
    element.style.height = `${widget.height}px`;
  }
}

// public/scene-manager/scene-background.ts
function sceneBackground(layout) {
  const value = layout.backgroundColor;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
function applySceneBackground(element, layout) {
  element.style.backgroundColor = sceneBackground(layout) ?? "";
}

// public/scene-manager/index.ts
var REFRESH_INTERVAL_MS = 50000;
var DRAFT_SETTLE_MS = 400;
function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function withNonce(frameUrl, nonce) {
  const url = new URL(frameUrl, location.href);
  url.searchParams.set("nonce", nonce);
  return url.pathname + url.search;
}
function placeAt(element, position) {
  element.style.left = `${position.x}px`;
  element.style.top = `${position.y}px`;
  element.style.width = `${position.width}px`;
  element.style.height = `${position.height}px`;
}
function renderConnected(connected) {
  const banner = document.getElementById("disconnected-banner");
  banner?.classList.toggle("visible", !connected);
  try {
    document.dispatchEvent(new CustomEvent("datastar-signal-patch", { detail: { connected } }));
  } catch {}
}
function main() {
  const sceneData = window.__WOOFX3_SCENE__?.scene;
  const container = document.getElementById("widgets");
  if (!sceneData || !container) {
    return;
  }
  applySceneBackground(document.body, sceneData.layout);
  const sceneId = sceneData.id;
  const sceneBase = `/scene/${encodeURIComponent(sceneId)}`;
  const bridges = new Set;
  const widgetElements = new Map;
  const queueManager = new EventQueueManager;
  const deliveredBatcher = new AckBatcher((eventId) => `${sceneBase}/events/${encodeURIComponent(eventId)}/delivered`);
  const completedBatcher = new AckBatcher((eventId) => `${sceneBase}/events/${encodeURIComponent(eventId)}/completed`);
  const moduleState = new ModuleStateCache(async (instanceId, key) => {
    const url = `${sceneBase}/widget/${encodeURIComponent(instanceId)}/storage?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, { credentials: "same-origin" });
    if (!resp.ok) {
      throw new Error(`module state ${key}: ${resp.status}`);
    }
    const body = await resp.json();
    return body.value ?? null;
  });
  const media = new MediaCache({
    sceneId,
    sceneBase,
    warn: (message, detail) => console.warn(message, detail)
  });
  fetch(`${sceneBase}/media-manifest`, { credentials: "same-origin", cache: "no-store" }).then((resp) => resp.ok ? resp.json() : { keys: [] }).then(async (body) => {
    const keys = Array.isArray(body.keys) ? body.keys.filter((key) => typeof key === "string") : [];
    await media.prune(keys);
    await media.prefetch(keys);
  }).catch((err) => console.warn("[scene-manager] media manifest unavailable", { error: String(err) }));
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
  function postAlertAck(kind, eventId, instanceId) {
    fetch(`${sceneBase}/events/${encodeURIComponent(eventId)}/${kind}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceIds: [instanceId] })
    }).catch(() => {});
  }
  const mounted = new Map;
  const framedBridges = new Map;
  const mountAlertWidget = (instance) => {
    const element = document.createElement("div");
    element.className = "alert-widget";
    placeAt(element, instance.position);
    container.appendChild(element);
    widgetElements.set(instance.id, element);
    const subId = `alert:${instance.id}`;
    const alertWidget = new AlertWidget({
      element,
      sceneBase,
      bridges,
      media,
      generateNonce,
      postStatus,
      onFinished: (eventId) => {
        queueManager.complete(subId, eventId);
        postAlertAck("completed", eventId, instance.id);
      }
    });
    queueManager.register(subId, instance.id, { maxInFlight: 1 }, (item) => {
      postAlertAck("started", item.eventId, instance.id);
      return alertWidget.play(item);
    }, () => {}, (eventId) => alertWidget.stop(eventId));
    return () => {
      alertWidget.dispose();
      queueManager.unregister(subId);
      widgetElements.delete(instance.id);
      element.remove();
    };
  };
  const mountFramedWidget = (instance) => {
    const iframe = document.createElement("iframe");
    iframe.className = "widget-frame";
    placeAt(iframe, instance.position);
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("allow", "autoplay");
    const nonce = generateNonce();
    let currentSubId = null;
    const callbacks = {
      onStorageGet: (_moduleId, key) => moduleState.peek(instance.moduleId, key),
      onStorageSubscribe: (_moduleId, key) => moduleState.watch(instance.moduleId, key, storageTarget),
      onStorageUnsubscribe: (_moduleId, key) => moduleState.unwatch(instance.moduleId, key, storageTarget),
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
      onMediaGet: (url) => media.load(url),
      onDispose: () => {
        if (currentSubId) {
          queueManager.unregister(currentSubId);
          currentSubId = null;
        }
      }
    };
    const bridge = new WidgetBridge(instance.id, nonce, callbacks);
    const storageTarget = {
      instanceId: instance.id,
      sendStorageValue: (key, value) => bridge.sendStorageValue(key, value)
    };
    iframe.addEventListener("load", createFrameLoadHandler(bridge));
    iframe.src = withNonce(instance.frameUrl, nonce);
    bridges.add(bridge);
    framedBridges.set(instance.id, bridge);
    container.appendChild(iframe);
    widgetElements.set(instance.id, iframe);
    bridge.attach(iframe);
    return () => {
      bridge.dispose();
      bridge.detach();
      bridges.delete(bridge);
      if (framedBridges.get(instance.id) === bridge) {
        framedBridges.delete(instance.id);
      }
      moduleState.unwatchAll(storageTarget);
      widgetElements.delete(instance.id);
      iframe.remove();
    };
  };
  function mount(instance) {
    const unmount = instance.hostsSurface === "alert" ? mountAlertWidget(instance) : mountFramedWidget(instance);
    mounted.set(instance.id, { config: instance, unmount });
  }
  function stack(order) {
    order.forEach((id, index) => {
      const element = widgetElements.get(id);
      if (element) {
        element.style.zIndex = String(index);
      }
    });
  }
  for (const instance of sceneData.widgets) {
    mount(instance);
  }
  stack(sceneData.widgets.map((instance) => instance.id));
  let previewLayout = null;
  let draftPlacements = null;
  let draftKey = "";
  let draftTimer = null;
  window.addEventListener("message", (event) => {
    for (const bridge of bridges) {
      bridge.handleMessage(event);
    }
  });
  function takesSettingsLive(id) {
    return framedBridges.get(id)?.acceptsSettings() ?? false;
  }
  function changeSettingsLive(id, settings) {
    const entry = mounted.get(id);
    const bridge = framedBridges.get(id);
    if (!entry || !bridge?.acceptsSettings() || !canChangeSettingsLive(entry.config.settings, settings)) {
      return false;
    }
    if (!sameValue(entry.config.settings, settings)) {
      bridge.sendSettings(settings);
      entry.config = { ...entry.config, settings };
    }
    return true;
  }
  if (window.parent !== window) {
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) {
        return;
      }
      const layout = parsePreviewLayout(event.data);
      if (layout) {
        previewLayout = layout;
        applyPreviewLayout(widgetElements, layout);
      }
      const placements = parsePreviewPlacements(event.data);
      if (placements) {
        draftPlacements = placements;
        for (const raw of placements) {
          const placement = typeof raw === "object" && raw !== null ? raw : {};
          if (typeof placement.id === "string") {
            changeSettingsLive(placement.id, settingsOf(placement));
          }
        }
        const key = draftFrameKey(placements, takesSettingsLive);
        if (key !== draftKey) {
          draftKey = key;
          if (draftTimer !== null) {
            clearTimeout(draftTimer);
          }
          draftTimer = setTimeout(() => {
            draftTimer = null;
            updateScene();
          }, DRAFT_SETTLE_MS);
        }
      }
    });
  }
  function applySceneConfig(next, fromDraft) {
    for (const instance of next.widgets) {
      const entry = mounted.get(instance.id);
      if (!entry || !takesSettingsLive(instance.id)) {
        continue;
      }
      if (fromDraft && canChangeSettingsLive(entry.config.settings, instance.settings)) {
        instance.settings = entry.config.settings;
        continue;
      }
      changeSettingsLive(instance.id, instance.settings);
    }
    const plan = planSceneUpdate([...mounted.values()].map((entry) => entry.config), next.widgets);
    for (const id of plan.remove) {
      mounted.get(id)?.unmount();
      mounted.delete(id);
    }
    for (const instance of plan.place) {
      const entry = mounted.get(instance.id);
      const element = widgetElements.get(instance.id);
      if (entry && element) {
        entry.config = instance;
        placeAt(element, instance.position);
      }
    }
    for (const instance of plan.mount) {
      mount(instance);
    }
    stack(plan.order);
    applySceneBackground(document.body, next.layout);
    if (previewLayout) {
      applyPreviewLayout(widgetElements, previewLayout);
    }
  }
  async function fetchTarget() {
    const draft = draftPlacements;
    let resp;
    try {
      resp = draft ? await fetch(`${sceneBase}/draft-config`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets: draft })
      }) : await fetch(`${sceneBase}/config`, { credentials: "same-origin", cache: "no-store" });
    } catch {
      return draft ? { kind: "keep" } : { kind: "reload" };
    }
    const config = resp.ok ? parseSceneConfig(await resp.json().catch(() => null)) : null;
    if (config && config.id === sceneId) {
      return { kind: "apply", config, fromDraft: draft !== null };
    }
    if (draft && resp.status !== 401) {
      console.warn("[scene-manager] draft preview refused; showing the last one", { status: resp.status });
      return { kind: "keep" };
    }
    return { kind: "reload" };
  }
  let updating = false;
  let updateRequested = false;
  async function updateScene() {
    updateRequested = true;
    if (updating) {
      return;
    }
    updating = true;
    try {
      while (updateRequested) {
        updateRequested = false;
        const target = await fetchTarget();
        if (target.kind === "reload") {
          location.reload();
          return;
        }
        if (target.kind === "apply") {
          applySceneConfig(target.config, target.fromDraft);
        }
      }
    } finally {
      updating = false;
    }
  }
  const status = new ConnectionStatus(renderConnected);
  let serverBootId = null;
  const coordinator = createReconnectCoordinator();
  function reloadOverlay() {
    coordinator.requestPeerReload();
    location.reload();
  }
  coordinator.onPeerReload(() => {
    location.reload();
  });
  const eventSource = new SceneEventSource({
    url: new URL(`${sceneBase}/events`, location.href).toString(),
    coordinator
  });
  eventSource.start({
    onFrame: (frame) => {
      deliveredBatcher.add(frame.eventId, frame.instanceId);
      queueManager.enqueue(frame.instanceId, {
        eventId: frame.eventId,
        type: frame.type,
        key: frame.key,
        value: frame.value
      });
    },
    onModuleState: (frame) => moduleState.apply(frame.moduleId, frame.key, frame.value),
    onCancel: (frame) => queueManager.cancel(frame.instanceId, frame.eventIds),
    onConnectionChange: (connected) => status.set("stream", connected),
    onSceneUpdated: () => void updateScene(),
    onHello: (bootId) => {
      if (serverBootId !== null && serverBootId !== bootId) {
        reloadOverlay();
        return;
      }
      if (serverBootId !== null) {
        moduleState.refresh();
      }
      serverBootId = bootId;
    },
    onSessionExpired: () => {
      reloadOverlay();
    }
  });
  setInterval(() => {
    fetch(`${sceneBase}/session/refresh`, { method: "POST", credentials: "same-origin" }).then((resp) => {
      if (!resp.ok) {
        throw new Error(`refresh failed: ${resp.status}`);
      }
      status.set("session", true);
    }).catch(() => {
      status.set("session", false);
    });
  }, REFRESH_INTERVAL_MS);
}
main();
