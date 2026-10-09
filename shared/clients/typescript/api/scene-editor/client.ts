// The scene editor's sync client, without a framework.
//
// One client edits one scene, both versions, over the protocol 2 socket. It
// keeps exactly what the server confirmed (`server`), one item in flight, and
// a FIFO queue of items not yet sent; the documents the editor shows
// (`local`) are always the confirmed documents with the pending edits
// applied. Publish and discard are queue items with no local effect: their
// result arrives as an entry like anyone else's change, and the edits queued
// behind them are transformed against it. The socket, timers, session
// opening and id generation are injected, so the client runs the same in a
// browser, in tests and in a simulation.
//
// Invariants, checked by `assertSyncInvariants`:
// - I1 At most one item is in flight, and only it has a seq. A resend keeps
//   its seq and never merges anything into it.
// - I2 `local[v]` is `server.docs[v]` with the edit ops of the in-flight item
//   and the queue applied in order; commands contribute no ops.
// - I3 Every item leaves exactly once: confirmed, rejected (reported), or
//   reported when the client closes or the scene is gone.
// - I4 A reply whose seq is not the in-flight item's is ignored.
// - I5 An edit is a function of the current local document.

import {
  applyOps,
  composeOps,
  diffDocuments,
  type Entry,
  invalidOps,
  invalidResult,
  invertOps,
  MAX_OPS_BYTES,
  mergeMeta,
  type Ops,
  opsSize,
  type PlacementMeta,
  type SceneDocument,
  sameValue,
  transformOps,
  VERSIONS,
  type Version,
} from "./document";
import {
  CLOSE_CODES,
  type ClientMessage,
  decodeServerMessage,
  type EditorSnapshot,
  type ItemBody,
  isWelcomeSnapshot,
  type NackMessage,
  PROTOCOL_VERSION,
  type ServerPresenceMessage,
  type Watermark,
  type WelcomeMessage,
} from "./protocol";
import { rebaseFieldwise } from "./rebase";

/** Least time between two item sends. */
export const SEND_SPACING_MS = 100;
/** How long `stop()` keeps going before reporting what is left. */
export const DRAIN_DEADLINE_MS = 10_000;
/** How often to ask for a session again while the engine is unavailable. */
export const UNAVAILABLE_RETRY_MS = 30_000;
/** Backoff for reconnects and for resending after `unavailable`: 1 s, 2 s, 4 s, ... capped. */
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 10_000;
/**
 * How long a session must stay ready before the reconnect backoff starts
 * over. A session that ends sooner (one that fails right after its welcome)
 * waits at least `BACKOFF_BASE_MS` and keeps growing the backoff, so a
 * failure that repeats on every welcome cannot spin.
 */
export const SESSION_HEALTHY_MS = 10_000;
/** The close code the client uses when it drops a socket to start the session over. */
export const CLIENT_RESTART_CLOSE_CODE = 4000;

export type ConnState = "connecting" | "ready" | "offline" | "unavailable" | "gone" | "closed";

export interface SyncSocket {
  send(text: string): void;
  close(code: number, reason: string): void;
}

export interface SyncSocketHandlers {
  onOpen(): void;
  onMessage(text: string): void;
  onClose(code: number, reason: string): void;
}

/** Opens a socket to `url`. Handlers are not called synchronously from inside this call. */
export type ConnectSocket = (url: string, handlers: SyncSocketHandlers) => SyncSocket;

export interface SyncClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** One undelivered thing in a report. `sent` and `maybeRan` say whether the server may have it. */
export type ReportItem =
  | { kind: "edits"; version: Version; sent: boolean }
  | { kind: "publish" | "discard"; maybeRan: boolean };

/**
 * Something the user should hear about:
 * - `closed`: `stop()` ran out of time with these items undelivered.
 * - `gone`: the scene no longer exists; these items went with it.
 * - `rejected`: the server refused these items; their edits were rolled back.
 * - `history_lost`: the server lost changes it had confirmed (a crash), and
 *   the editor now shows the scene as the server has it.
 */
export interface SyncReport {
  reason: "closed" | "gone" | "rejected" | "history_lost";
  items: ReportItem[];
  detail?: string;
}

export interface PeerPresence {
  clientId: string;
  name: string;
  selection: string | null;
  version: Version;
}

/** What a view renders. A new object whenever anything in it changes; the same object otherwise. */
export interface SceneSyncState {
  conn: ConnState;
  stopping: boolean;
  /** An item is waiting to be resent after the engine said it was unavailable. */
  retrying: boolean;
  /** Both versions as this editor sees them, or null until the scene has loaded. */
  local: Readonly<Record<Version, SceneDocument>> | null;
  meta: Readonly<Record<Version, Record<string, PlacementMeta>>> | null;
  hasDraft: boolean;
  name: string;
  /** The first publish or discard not yet confirmed, in flight or queued. */
  pendingCommand: "publish" | "discard" | null;
  pendingItems: number;
  peers: readonly PeerPresence[];
}

export interface SceneSyncClientOptions {
  /** A socket URL for a new session, or null when the engine cannot give one now. */
  open: () => Promise<string | null>;
  connect: ConnectSocket;
  clock: SyncClock;
  newClientId: () => string;
  /** Shown to other editors. */
  name: string;
  onReport?: (report: SyncReport) => void;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

export type EditResult = { ok: true } | { ok: false; detail: string };

/** What the server confirmed: the head this client has applied and the documents at it. */
interface ServerView {
  v: number;
  id: string;
  docs: Record<Version, SceneDocument>;
  meta: Record<Version, Record<string, PlacementMeta>>;
  hasDraft: boolean;
  name: string;
}

interface QueuedItem {
  /** Identifies the item for I3 bookkeeping only; never sent. */
  id: number;
  body: ItemBody;
}

interface SentItem extends QueuedItem {
  seq: number;
  base: number;
}

/** A copy of the client's internals, for checking invariants. */
export interface SyncClientInternals {
  clientId: string;
  conn: ConnState;
  nextSeq: number;
  server: ServerView | null;
  inflight: SentItem | null;
  queue: QueuedItem[];
  local: Record<Version, SceneDocument> | null;
  liveItemIds: number[];
  created: number;
  left: number;
}

export class SceneSyncClient {
  private readonly options: SceneSyncClientOptions;
  private readonly clientId: string;
  private nextSeq = 1;
  private nextItemId = 1;
  private server: ServerView | null = null;
  private inflight: SentItem | null = null;
  private queue: QueuedItem[] = [];
  private local: Record<Version, SceneDocument> | null = null;
  private conn: ConnState = "connecting";
  private started = false;
  private stopping: { deadline: number; timer: unknown } | null = null;
  private socket: SyncSocket | null = null;
  /** Bumped whenever the current socket or session attempt is abandoned, so its late events are ignored. */
  private generation = 0;
  private welcomed = false;
  private forceSnapshot = false;
  private reconnectAttempt = 0;
  private reconnectTimer: unknown = null;
  /** When the current session was welcomed; null while there is none. */
  private readySince: number | null = null;
  private resendAttempt = 0;
  private resendTimer: unknown = null;
  private pumpTimer: unknown = null;
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private presence: { selection: string | null; version: Version } | null = null;
  private readonly peers = new Map<string, PeerPresence>();
  private readonly listeners = new Set<() => void>();
  private readonly liveItemIds = new Set<number>();
  private created = 0;
  private left = 0;
  private state: SceneSyncState;

  constructor(options: SceneSyncClientOptions) {
    this.options = options;
    this.clientId = options.newClientId();
    assert(this.clientId.length > 0, "a client id is non-empty");
    this.state = this.buildState();
  }

  get id(): string {
    return this.clientId;
  }

  /** Open the first session. Called once. */
  start(): void {
    assert(!this.started, "a client is started once");
    this.started = true;
    void this.connectNow();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): SceneSyncState => this.state;

  /** Whether anything is not yet confirmed by the server. */
  hasPending(): boolean {
    return this.inflight !== null || this.queue.length > 0;
  }

  /**
   * Change a version: `update` gets the document as this editor shows it and
   * returns the next one. The difference is queued and shows at once. Refused,
   * changing nothing, before the scene has loaded, after the client ended,
   * or when the change is not a valid scene edit.
   */
  edit(version: Version, update: (doc: SceneDocument) => SceneDocument): EditResult {
    if (this.local === null || this.isEnded()) {
      return { ok: false, detail: "the scene is not open for editing" };
    }
    const current = this.local[version];
    const next = update(structuredClone(current));
    const ops = diffDocuments(current, next);
    if (ops.length === 0) {
      return { ok: true };
    }
    const chunks = splitOps(ops);
    for (const chunk of chunks) {
      const invalid = invalidOps(chunk) ?? (opsSize(chunk) > MAX_OPS_BYTES ? "ops too large" : null);
      if (invalid !== null) {
        return { ok: false, detail: invalid };
      }
    }
    let applied: SceneDocument;
    try {
      applied = applyOps(current, ops);
    } catch (err) {
      return { ok: false, detail: `the change does not apply: ${errorText(err)}` };
    }
    const invalidDoc = invalidResult(applied, ops);
    if (invalidDoc !== null) {
      return { ok: false, detail: invalidDoc };
    }
    for (const chunk of chunks) {
      this.enqueueEdit(version, chunk);
    }
    this.local = version === "draft" ? { ...this.local, draft: applied } : { ...this.local, published: applied };
    this.changed();
    this.pump();
    return { ok: true };
  }

  /** Queue making the draft the published scene. False when the client cannot take it. */
  publish(): boolean {
    return this.enqueueCommand({ kind: "publish" });
  }

  /** Queue throwing the draft away. False when the client cannot take it. */
  discard(): boolean {
    return this.enqueueCommand({ kind: "discard" });
  }

  /** What this editor has selected, shown to the others. */
  setPresence(selection: string | null, version: Version): void {
    this.presence = { selection, version };
    if (this.conn === "ready" && this.stopping === null) {
      this.send({ type: "presence", selection, version });
    }
  }

  /**
   * Finish delivering what is pending, then close. Reconnects stop at the
   * deadline; anything still undelivered then is reported. Closes at once
   * when nothing is pending.
   */
  stop(): void {
    if (this.isEnded() || this.stopping !== null) {
      return;
    }
    const timer = this.options.clock.setTimeout(() => this.deadlineReached(), DRAIN_DEADLINE_MS);
    this.stopping = { deadline: this.options.clock.now() + DRAIN_DEADLINE_MS, timer };
    if (this.conn === "ready") {
      this.send({ type: "presence", away: true });
    }
    if (!this.finishIfDrained()) {
      this.changed();
    }
  }

  /** Cancel `stop()`: the editor is back. False when the client already ended. */
  resume(): boolean {
    if (this.isEnded()) {
      return false;
    }
    if (this.stopping !== null) {
      this.options.clock.clearTimeout(this.stopping.timer);
      this.stopping = null;
      if (this.conn === "ready" && this.presence !== null) {
        this.send({ type: "presence", ...this.presence });
      }
      if (this.conn === "offline" && this.reconnectTimer === null) {
        this.scheduleReconnect();
      }
      this.changed();
    }
    return true;
  }

  /** Close now and report nothing: the scene was deleted on purpose. */
  abandon(): void {
    if (this.isEnded()) {
      return;
    }
    for (const item of this.pendingItems()) {
      this.leave(item);
    }
    this.inflight = null;
    this.queue = [];
    this.recomputeLocal();
    this.end("closed");
  }

  /** A copy of the internals, for `assertSyncInvariants`. */
  inspect(): SyncClientInternals {
    return structuredClone({
      clientId: this.clientId,
      conn: this.conn,
      nextSeq: this.nextSeq,
      server: this.server,
      inflight: this.inflight,
      queue: this.queue,
      local: this.local,
      liveItemIds: [...this.liveItemIds],
      created: this.created,
      left: this.left,
    });
  }

  // -------------------------------------------------------------------------
  // Queue

  private enqueueEdit(version: Version, ops: Ops): void {
    const tail = this.queue[this.queue.length - 1];
    if (tail !== undefined && tail.body.kind === "edit" && tail.body.version === version) {
      const composed = composeOps(tail.body.ops, ops);
      if (opsSize(composed) <= MAX_OPS_BYTES) {
        tail.body = { kind: "edit", version, ops: composed };
        return;
      }
    }
    this.queue.push(this.newItem({ kind: "edit", version, ops }));
  }

  private enqueueCommand(body: ItemBody): boolean {
    if (this.local === null || this.isEnded()) {
      return false;
    }
    this.queue.push(this.newItem(body));
    this.changed();
    this.pump();
    return true;
  }

  private newItem(body: ItemBody): QueuedItem {
    const item: QueuedItem = { id: this.nextItemId++, body };
    this.liveItemIds.add(item.id);
    this.created++;
    return item;
  }

  /** I3: an item leaves the client exactly once. */
  private leave(item: QueuedItem): void {
    assert(this.liveItemIds.delete(item.id), "an item leaves exactly once");
    this.left++;
  }

  private pendingItems(): QueuedItem[] {
    return this.inflight === null ? [...this.queue] : [this.inflight, ...this.queue];
  }

  /** Send the head of the queue when the session is ready, nothing is in flight, and the spacing allows. */
  private pump(): void {
    if (this.pumpTimer !== null) {
      this.options.clock.clearTimeout(this.pumpTimer);
      this.pumpTimer = null;
    }
    while (this.conn === "ready" && this.inflight === null && this.queue.length > 0) {
      const wait = this.lastSentAt + SEND_SPACING_MS - this.options.clock.now();
      if (wait > 0) {
        this.pumpTimer = this.options.clock.setTimeout(() => {
          this.pumpTimer = null;
          this.pump();
        }, wait);
        return;
      }
      const item = this.queue.shift()!;
      if (item.body.kind === "edit" && item.body.ops.length === 0) {
        // Transformed away by others' changes: there is nothing left to send.
        this.leave(item);
        continue;
      }
      assert(this.server !== null, "a ready session has the scene");
      this.inflight = { ...item, seq: this.nextSeq++, base: this.server.v };
      this.sendInflight();
      this.changed();
    }
    this.finishIfDrained();
  }

  private sendInflight(): void {
    const inflight = this.inflight;
    assert(inflight !== null && this.server !== null, "only an in-flight item is sent");
    this.splitInflight(inflight);
    inflight.base = this.server.v;
    this.lastSentAt = this.options.clock.now();
    this.send({ type: "item", seq: inflight.seq, base: inflight.base, body: inflight.body });
  }

  /**
   * Keep an in-flight edit within `MAX_OPS_BYTES` before it goes out: an
   * edit can outgrow it after it was queued, as transforms and rebasing
   * rewrite it. The in-flight item keeps the first run of components and its
   * seq; the rest go back to the front of the queue as new items, so the
   * order of every component is unchanged (I2). This never splits a seq the
   * server may have decided: an item is sent or resent only while its seq is
   * above the watermark (first send, after a welcome below it, or after
   * `unavailable`). A single component larger than the limit stays whole;
   * the server takes it up to `MAX_ITEM_BYTES`.
   */
  private splitInflight(inflight: SentItem): void {
    const body = inflight.body;
    if (body.kind !== "edit" || opsSize(body.ops) <= MAX_OPS_BYTES) {
      return;
    }
    const [first, ...rest] = splitOps(body.ops);
    if (first === undefined || rest.length === 0) {
      return;
    }
    inflight.body = { kind: "edit", version: body.version, ops: first };
    this.queue.unshift(...rest.map((ops) => this.newItem({ kind: "edit", version: body.version, ops })));
    this.changed();
  }

  // -------------------------------------------------------------------------
  // Session

  private async connectNow(): Promise<void> {
    this.reconnectTimer = null;
    if (this.isEnded()) {
      return;
    }
    const generation = ++this.generation;
    this.conn = "connecting";
    this.welcomed = false;
    this.changed();
    let url: string | null;
    try {
      url = await this.options.open();
    } catch (err) {
      if (generation === this.generation && !this.isEnded()) {
        this.log("opening a session failed", { error: errorText(err) });
        this.goOffline();
      }
      return;
    }
    if (generation !== this.generation || this.isEnded()) {
      return;
    }
    if (url === null) {
      this.conn = "unavailable";
      this.reconnectTimer = this.options.clock.setTimeout(() => void this.connectNow(), UNAVAILABLE_RETRY_MS);
      this.changed();
      return;
    }
    try {
      this.socket = this.options.connect(url, {
        onOpen: () => {
          if (generation === this.generation) {
            this.sendHello();
          }
        },
        onMessage: (text) => {
          if (generation === this.generation) {
            this.receive(text);
          }
        },
        onClose: (code, reason) => {
          if (generation === this.generation) {
            this.socketClosed(code, reason);
          }
        },
      });
    } catch (err) {
      this.log("opening the socket failed", { error: errorText(err) });
      this.goOffline();
    }
  }

  private sendHello(): void {
    const have = this.forceSnapshot || this.server === null ? null : { v: this.server.v, id: this.server.id };
    this.send({ type: "hello", protocol: PROTOCOL_VERSION, clientId: this.clientId, have, name: this.options.name });
  }

  private socketClosed(code: number, reason: string): void {
    this.socket = null;
    if (this.isEnded()) {
      return;
    }
    if (code === CLOSE_CODES.notFound) {
      this.sceneGone(reason || "the scene was not found");
      return;
    }
    if (code === CLOSE_CODES.unsupportedProtocol || code === CLOSE_CODES.replaced) {
      // Neither is cured by reconnecting: the engine does not speak this
      // protocol, or another socket took this client's id.
      this.endWithReport("closed", reason || `the editor session ended (${code})`);
      return;
    }
    this.goOffline();
  }

  /** Drop the current session and start a new one after the backoff. */
  private restartSession(reason: string, forceSnapshot: boolean): void {
    this.log("restarting the session", { reason });
    if (forceSnapshot) {
      this.forceSnapshot = true;
    }
    this.goOffline();
  }

  private goOffline(): void {
    this.generation++;
    if (this.socket !== null) {
      const socket = this.socket;
      this.socket = null;
      socket.close(CLIENT_RESTART_CLOSE_CODE, "reconnecting");
    }
    const readyFor = this.readySince === null ? null : this.options.clock.now() - this.readySince;
    this.readySince = null;
    if (readyFor !== null && readyFor >= SESSION_HEALTHY_MS) {
      this.reconnectAttempt = 0;
    }
    this.clearResend();
    this.welcomed = false;
    this.conn = "offline";
    this.peers.clear();
    this.scheduleReconnect(readyFor !== null && readyFor < SESSION_HEALTHY_MS ? BACKOFF_BASE_MS : 0);
    this.changed();
  }

  /** Reconnect after the backoff, and no sooner than `minDelay`. */
  private scheduleReconnect(minDelay = 0): void {
    if (this.reconnectTimer !== null) {
      this.options.clock.clearTimeout(this.reconnectTimer);
    }
    const delay = Math.max(minDelay, backoff(this.reconnectAttempt++));
    if (this.stopping !== null && this.options.clock.now() + delay >= this.stopping.deadline) {
      // The drain deadline comes first and reports what is left.
      this.reconnectTimer = null;
      return;
    }
    this.reconnectTimer = this.options.clock.setTimeout(() => void this.connectNow(), delay);
  }

  private send(message: ClientMessage): void {
    if (this.socket === null) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  /**
   * Handle one message. Nothing thrown while handling it escapes to the
   * socket: each step works out its result before assigning any of it, so a
   * failure leaves the client as it was, and the session starts over on a
   * snapshot.
   */
  private receive(text: string): void {
    try {
      this.handle(text);
    } catch (err) {
      if (this.isEnded()) {
        this.log("handling a message failed after the client ended", { error: errorText(err) });
        return;
      }
      this.restartSession(`handling a message failed: ${errorText(err)}`, true);
    }
  }

  private handle(text: string): void {
    const message = decodeServerMessage(text);
    if (message === null) {
      this.restartSession("the server sent a message that is not protocol 2", true);
      return;
    }
    if (message.type === "error") {
      if (message.code === "protocol") {
        this.restartSession(`the server reported a protocol error: ${message.detail}`, true);
      } else if (message.code === "not_found") {
        this.sceneGone(message.detail);
      } else {
        this.endWithReport("closed", message.detail);
      }
      return;
    }
    if (message.type === "welcome") {
      if (this.welcomed) {
        this.restartSession("a second welcome", true);
        return;
      }
      this.welcome(message);
      return;
    }
    if (!this.welcomed) {
      this.restartSession(`${message.type} before welcome`, true);
      return;
    }
    switch (message.type) {
      case "entry": {
        if (this.applyEntry(message)) {
          this.pump();
        }
        break;
      }
      case "ack": {
        this.acked(message.seq, message.v);
        break;
      }
      case "nack": {
        this.nacked(message);
        break;
      }
      case "presence": {
        this.peerPresence(message);
        break;
      }
    }
  }

  private welcome(message: WelcomeMessage): void {
    if (message.clientId !== this.clientId) {
      this.restartSession("a welcome for another client", true);
      return;
    }
    if (isWelcomeSnapshot(message)) {
      this.welcomeSnapshot(message.snapshot, message.last, message.diverged);
    } else if (!this.welcomeCatchup(message.catchup, message.last)) {
      return;
    }
    this.welcomed = true;
    this.forceSnapshot = false;
    this.readySince = this.options.clock.now();
    this.conn = "ready";
    this.peers.clear();
    if (this.stopping !== null) {
      this.send({ type: "presence", away: true });
    } else if (this.presence !== null) {
      this.send({ type: "presence", ...this.presence });
    }
    const inflight = this.inflight;
    if (inflight !== null && inflight.body.kind === "edit" && inflight.body.ops.length === 0) {
      // The server has not decided this seq (the watermark is below it) and
      // nothing of it is left to send, so it is done without a reply.
      this.leave(inflight);
      this.inflight = null;
    }
    this.changed();
    if (this.inflight !== null) {
      this.sendInflight();
    } else {
      this.pump();
    }
    this.finishIfDrained();
  }

  /** Apply the entries missed, then settle the in-flight item by the watermark. False when the session restarted. */
  private welcomeCatchup(entries: readonly Entry[], last: Watermark | null): boolean {
    if (this.server === null) {
      this.restartSession("a catch-up before any snapshot", true);
      return false;
    }
    for (const entry of entries) {
      if (!this.applyEntry(entry)) {
        return false;
      }
    }
    const inflight = this.inflight;
    const decided = decisionOf(inflight, last);
    if (inflight === null || decided === null) {
      return true;
    }
    if (decided === "rejected") {
      return this.rejectInflight("this change could not be saved");
    }
    // Applied, yet its entry was not among those missed: it committed
    // nothing, as an `ack` would have said.
    let local: Record<Version, SceneDocument>;
    try {
      local = localOf(
        this.server.docs,
        this.queue.map((item) => item.body)
      );
    } catch (err) {
      this.restartSession(`the queue does not apply without the confirmed item: ${errorText(err)}`, true);
      return false;
    }
    this.leave(inflight);
    this.inflight = null;
    this.local = local;
    return true;
  }

  /**
   * Adopt the server's documents and move what is pending onto them with
   * `rebaseFieldwise`. An in-flight item the watermark has decided is not
   * carried over, but the queue was made on top of it: when it was applied,
   * the queue is rebased from the old documents with it applied (the
   * snapshot has its effect already); when it was rejected, the queue is
   * first rolled back past it as for a `nack`. Cannot fail: whatever cannot
   * be moved is dropped and reported.
   */
  private welcomeSnapshot(snapshot: EditorSnapshot, last: Watermark | null, diverged: boolean): void {
    const inflight = this.inflight;
    const decided = decisionOf(inflight, last);
    const settled =
      inflight !== null && decided !== null ? { body: inflight.body, applied: decided === "applied" } : null;
    const carried = settled === null ? this.pendingItems() : [...this.queue];
    assert(
      this.server !== null || (inflight === null && carried.length === 0),
      "nothing is pending before the scene first loads"
    );
    const sentId = settled === null && inflight !== null ? inflight.id : null;
    const target: Record<Version, SceneDocument> = {
      draft: structuredClone(snapshot.docs.draft),
      published: structuredClone(snapshot.docs.published),
    };
    let moved: { bodies: Array<ItemBody | null>; local: Record<Version, SceneDocument> };
    try {
      moved = carryOntoSnapshot(
        this.server?.docs ?? null,
        settled,
        carried.map((item) => item.body),
        target
      );
    } catch (err) {
      this.log("pending changes could not be moved onto the snapshot", { error: errorText(err) });
      moved = { bodies: carried.map(() => null), local: { draft: target.draft, published: target.published } };
    }
    const kept: QueuedItem[] = [];
    const dropped: QueuedItem[] = [];
    carried.forEach((item, index) => {
      const body = moved.bodies[index];
      if (body === null || body === undefined) {
        dropped.push(item);
      } else {
        item.body = body;
        kept.push(item);
      }
    });
    if (settled !== null && inflight !== null) {
      this.leave(inflight);
    }
    this.inflight = inflight !== null && settled === null && kept.includes(inflight) ? inflight : null;
    this.queue = kept.filter((item) => item !== this.inflight);
    this.server = {
      v: snapshot.v,
      id: snapshot.id,
      docs: target,
      meta: structuredClone(snapshot.meta),
      hasDraft: snapshot.hasDraft,
      name: snapshot.name,
    };
    this.local = moved.local;
    for (const item of dropped) {
      this.leave(item);
    }
    if (settled !== null && !settled.applied && inflight !== null) {
      this.report({
        reason: "rejected",
        items: reportItems([inflight], inflight.id, false),
        detail: "this change could not be saved",
      });
    }
    if (dropped.length > 0) {
      this.report({
        reason: "rejected",
        items: reportItems(dropped, sentId, false),
        detail: "these changes could not be moved onto the scene as it now stands",
      });
    }
    if (diverged) {
      this.report({ reason: "history_lost", items: [] });
    }
  }

  /**
   * Apply one entry the server committed, the next after `server.v`. The
   * client's own in-flight item is confirmed by it; for every other change,
   * each changed version's pending edits are transformed past it (ShareDB's
   * double transform: pending as "left", the server's op as "right"). On any
   * failure nothing is assigned, and the session restarts on a snapshot.
   */
  private applyEntry(entry: Entry): boolean {
    const server = this.server;
    assert(server !== null, "entries follow a snapshot");
    if (entry.v !== server.v + 1) {
      this.restartSession(`entry ${entry.v} after ${server.v}`, true);
      return false;
    }
    const inflight = this.inflight;
    const own =
      inflight !== null && entry.src !== null && entry.src.clientId === this.clientId && entry.src.seq === inflight.seq;
    let inflightBody = inflight?.body ?? null;
    const queueBodies = this.queue.map((item) => item.body);
    const docs = { ...server.docs };
    assert(this.local !== null, "a loaded scene has local documents");
    const local: Record<Version, SceneDocument> = { ...this.local };
    try {
      for (const version of VERSIONS) {
        const ops = entry.changes[version];
        if (ops === undefined) {
          continue;
        }
        docs[version] = applyOps(docs[version], ops);
        const ownChange =
          own && inflightBody !== null && inflightBody.kind === "edit" && inflightBody.version === version;
        if (ownChange) {
          // The server's form of this client's own op: the queue was made on top of it already.
          continue;
        }
        let remote = ops;
        if (!own && inflightBody !== null && inflightBody.kind === "edit" && inflightBody.version === version) {
          const mine = inflightBody.ops;
          inflightBody = { ...inflightBody, ops: transformOps(mine, remote, "left") };
          remote = transformOps(remote, mine, "right");
        }
        for (let i = 0; i < queueBodies.length; i++) {
          const body = queueBodies[i]!;
          if (body.kind !== "edit" || body.version !== version) {
            continue;
          }
          queueBodies[i] = { ...body, ops: transformOps(body.ops, remote, "left") };
          remote = transformOps(remote, body.ops, "right");
        }
      }
      // Only the versions this entry changed (and the one the confirmed item
      // edited) can differ: every other version's documents and pending ops
      // are as they were.
      const remaining = own ? queueBodies : [...(inflightBody === null ? [] : [inflightBody]), ...queueBodies];
      for (const version of VERSIONS) {
        const confirmed =
          own && inflight !== null && inflight.body.kind === "edit" && inflight.body.version === version;
        if (entry.changes[version] !== undefined || confirmed) {
          local[version] = withEdits(docs[version], version, remaining);
        }
      }
    } catch (err) {
      this.restartSession(`entry ${entry.v} does not apply: ${errorText(err)}`, true);
      return false;
    }
    let meta = server.meta;
    for (const version of VERSIONS) {
      const changes = entry.meta[version];
      if (changes !== undefined) {
        meta = { ...meta, [version]: mergeMeta(meta[version], changes) };
      }
    }
    this.server = { ...server, v: entry.v, id: entry.id, docs, meta, hasDraft: entry.hasDraft };
    this.queue.forEach((item, index) => {
      item.body = queueBodies[index]!;
    });
    if (own) {
      this.leave(inflight!);
      this.inflight = null;
      this.resendSucceeded();
    } else if (inflight !== null && inflightBody !== null) {
      inflight.body = inflightBody;
    }
    this.local = local;
    this.changed();
    return true;
  }

  private acked(seq: number, v: number): void {
    const inflight = this.inflight;
    if (inflight === null || seq !== inflight.seq) {
      return;
    }
    assert(this.server !== null, "a reply follows a welcome");
    if (v !== this.server.v) {
      // Every entry the decision saw is sent before the reply; a gap means a lost entry.
      this.restartSession(`ack at ${v} while at ${this.server.v}`, true);
      return;
    }
    let local: Record<Version, SceneDocument>;
    try {
      local = localOf(
        this.server.docs,
        this.queue.map((item) => item.body)
      );
    } catch (err) {
      this.restartSession(`the queue does not apply without the acknowledged item: ${errorText(err)}`, true);
      return;
    }
    this.leave(inflight);
    this.inflight = null;
    this.local = local;
    this.resendSucceeded();
    this.changed();
    this.pump();
  }

  private nacked(message: NackMessage): void {
    const inflight = this.inflight;
    if (inflight === null || message.seq !== inflight.seq) {
      return;
    }
    switch (message.code) {
      case "invalid": {
        this.resendSucceeded();
        if (this.rejectInflight(message.detail)) {
          this.changed();
          this.pump();
        }
        break;
      }
      case "stale_base": {
        this.restartSession(`stale base: ${message.detail}`, false);
        break;
      }
      case "unavailable": {
        this.clearResend();
        const delay = backoff(this.resendAttempt++ + 1);
        this.resendTimer = this.options.clock.setTimeout(() => {
          this.resendTimer = null;
          if (this.conn === "ready" && this.inflight === inflight) {
            this.sendInflight();
          }
          this.changed();
        }, delay);
        this.changed();
        break;
      }
    }
  }

  /**
   * The server refused the in-flight item, so nothing of it changed there.
   * An edit is rolled back softly: its inverse is treated as a remote change,
   * so edits queued after it keep what they can. The rolled-back queue is
   * worked out before anything is assigned; when that fails the client is
   * left as it was and the session restarts on a snapshot, where the
   * watermark settles the item again. False when the session restarted.
   */
  private rejectInflight(detail: string): boolean {
    const inflight = this.inflight;
    assert(inflight !== null && this.server !== null, "a rejection names the in-flight item");
    let queueBodies = this.queue.map((item) => item.body);
    let local: Record<Version, SceneDocument>;
    try {
      if (inflight.body.kind === "edit") {
        queueBodies = rollBack(inflight.body, queueBodies);
      }
      local = localOf(this.server.docs, queueBodies);
    } catch (err) {
      this.restartSession(`rolling back a refused change failed: ${errorText(err)}`, true);
      return false;
    }
    this.queue.forEach((item, index) => {
      item.body = queueBodies[index]!;
    });
    this.inflight = null;
    this.leave(inflight);
    this.local = local;
    this.report({ reason: "rejected", items: reportItems([inflight], inflight.id, false), detail });
    return true;
  }

  private resendSucceeded(): void {
    this.clearResend();
    this.resendAttempt = 0;
  }

  private clearResend(): void {
    if (this.resendTimer !== null) {
      this.options.clock.clearTimeout(this.resendTimer);
      this.resendTimer = null;
    }
  }

  private peerPresence(message: ServerPresenceMessage): void {
    if (message.clientId === this.clientId) {
      return;
    }
    if ("left" in message) {
      this.peers.delete(message.clientId);
    } else {
      this.peers.set(message.clientId, {
        clientId: message.clientId,
        name: message.name,
        selection: message.selection,
        version: message.version,
      });
    }
    this.changed();
  }

  // -------------------------------------------------------------------------
  // Ending

  private sceneGone(detail: string): void {
    this.endWithReport("gone", detail);
  }

  /** End now, reporting every pending item as undelivered. */
  private endWithReport(reason: "closed" | "gone", detail: string): void {
    const pending = this.pendingItems();
    const items = reportItems(pending, this.inflight === null ? null : this.inflight.id, true);
    for (const item of pending) {
      this.leave(item);
    }
    this.inflight = null;
    this.queue = [];
    this.recomputeLocal();
    this.end(reason === "gone" ? "gone" : "closed");
    if (items.length > 0 || reason === "gone") {
      this.report({ reason, items, detail });
    }
  }

  private finishIfDrained(): boolean {
    if (this.stopping === null || this.hasPending() || this.isEnded()) {
      return false;
    }
    this.end("closed");
    return true;
  }

  private deadlineReached(): void {
    if (this.stopping === null || this.isEnded()) {
      return;
    }
    this.stopping.timer = null;
    this.endWithReport("closed", "the editor closed before these changes were saved");
  }

  private end(conn: "closed" | "gone"): void {
    for (const timer of [this.reconnectTimer, this.resendTimer, this.pumpTimer, this.stopping?.timer ?? null]) {
      if (timer !== null) {
        this.options.clock.clearTimeout(timer);
      }
    }
    this.reconnectTimer = null;
    this.resendTimer = null;
    this.pumpTimer = null;
    this.stopping = null;
    this.generation++;
    if (this.socket !== null) {
      const socket = this.socket;
      this.socket = null;
      socket.close(1000, "editor closed");
    }
    this.conn = conn;
    this.peers.clear();
    this.changed();
  }

  private isEnded(): boolean {
    return this.conn === "closed" || this.conn === "gone";
  }

  // -------------------------------------------------------------------------
  // State

  private recomputeLocal(): void {
    if (this.server === null) {
      this.local = null;
      return;
    }
    this.local = localOf(
      this.server.docs,
      this.pendingItems().map((item) => item.body)
    );
  }

  private changed(): void {
    this.state = this.buildState();
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  private buildState(): SceneSyncState {
    const pending = this.pendingItems();
    const command = pending.find((item) => item.body.kind !== "edit");
    return {
      conn: this.conn,
      stopping: this.stopping !== null,
      retrying: this.resendTimer !== null || this.conn === "unavailable",
      local: this.local,
      meta: this.server?.meta ?? null,
      hasDraft: this.server?.hasDraft ?? false,
      name: this.server?.name ?? "",
      pendingCommand: command === undefined ? null : (command.body.kind as "publish" | "discard"),
      pendingItems: pending.length,
      peers: [...this.peers.values()],
    };
  }

  private report(report: SyncReport): void {
    this.options.onReport?.(report);
  }

  private log(event: string, detail?: Record<string, unknown>): void {
    this.options.log?.(event, detail);
  }
}

/** The documents an editor shows: `docs` with every pending edit applied in order (I2). */
export function localOf(
  docs: Readonly<Record<Version, SceneDocument>>,
  bodies: readonly ItemBody[]
): Record<Version, SceneDocument> {
  return { draft: withEdits(docs.draft, "draft", bodies), published: withEdits(docs.published, "published", bodies) };
}

/** `doc` with the ops of every edit to `version` in `bodies` applied in order: `doc` itself when there are none. */
function withEdits(doc: SceneDocument, version: Version, bodies: readonly ItemBody[]): SceneDocument {
  const ops = bodies.flatMap((body) => (body.kind === "edit" && body.version === version ? body.ops : []));
  return ops.length === 0 ? doc : applyOps(doc, ops);
}

/**
 * Whether the watermark in a welcome has decided the in-flight item: null
 * while its seq is above the watermark. A watermark past the item's seq
 * means the server applied it and went on to later items.
 */
function decisionOf(inflight: SentItem | null, last: Watermark | null): "applied" | "rejected" | null {
  if (inflight === null || last === null || last.seq < inflight.seq) {
    return null;
  }
  return last.seq === inflight.seq && last.outcome === "rejected" ? "rejected" : "applied";
}

/**
 * `bodies`, made after the refused edit `refused`, rewritten as if it had
 * never been made: its inverse is transformed through them as a remote
 * change. Throws when an op does not transform.
 */
function rollBack(refused: Extract<ItemBody, { kind: "edit" }>, bodies: readonly ItemBody[]): ItemBody[] {
  let remote = invertOps(refused.ops);
  return bodies.map((body) => {
    if (body.kind !== "edit" || body.version !== refused.version) {
      return body;
    }
    const rewritten: ItemBody = { ...body, ops: transformOps(body.ops, remote, "left") };
    remote = transformOps(remote, body.ops, "right");
    return rewritten;
  });
}

/**
 * `bodies`, pending on the documents `docs`, moved onto `target` with
 * `rebaseFieldwise`, and the documents the editor then shows. `settled` is
 * an item the server decided that `bodies` were made after: one it applied
 * is a prefix of the old chain (its effect is in `target`); one it rejected
 * is rolled back out of `bodies` first, or, when that does not transform,
 * kept as a prefix so the later edits still apply to the old chain. A body
 * comes back null when it could not be moved.
 */
function carryOntoSnapshot(
  docs: Readonly<Record<Version, SceneDocument>> | null,
  settled: { body: ItemBody; applied: boolean } | null,
  bodies: readonly ItemBody[],
  target: Readonly<Record<Version, SceneDocument>>
): { bodies: Array<ItemBody | null>; local: Record<Version, SceneDocument> } {
  if (bodies.length === 0 || docs === null) {
    assert(bodies.length === 0, "nothing is pending before the scene first loads");
    return { bodies: [], local: { draft: target.draft, published: target.published } };
  }
  let base: Readonly<Record<Version, SceneDocument>> = docs;
  let carried: readonly ItemBody[] = bodies;
  if (settled !== null && settled.body.kind === "edit") {
    const refused = settled.body;
    if (!settled.applied) {
      try {
        carried = rollBack(refused, bodies);
      } catch {
        base = withPrefix(docs, refused);
      }
    } else {
      base = withPrefix(docs, refused);
    }
  }
  const rebased = rebaseFieldwise(base, carried, target);
  const local = localOf(
    target,
    rebased.filter((body): body is ItemBody => body !== null)
  );
  return { bodies: rebased, local };
}

/** `docs` with `prefix` applied, or `docs` when it does not apply; later edits that needed it then fail to move. */
function withPrefix(
  docs: Readonly<Record<Version, SceneDocument>>,
  prefix: Extract<ItemBody, { kind: "edit" }>
): Readonly<Record<Version, SceneDocument>> {
  try {
    return localOf(docs, [prefix]);
  } catch {
    return docs;
  }
}

/** `ops` cut into consecutive runs no larger than `MAX_OPS_BYTES`; a single larger component stays alone. */
function splitOps(ops: Ops): Ops[] {
  const chunks: Ops[] = [];
  let chunk: Ops = [];
  for (const component of ops) {
    if (chunk.length > 0 && opsSize([...chunk, component]) > MAX_OPS_BYTES) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(component);
  }
  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * Items as a report lists them, consecutive edits to one version merged. The
 * item `sentId` names was sent; whether a sent command may have run is
 * `sentMayHaveRun`.
 */
function reportItems(items: readonly QueuedItem[], sentId: number | null, sentMayHaveRun: boolean): ReportItem[] {
  const report: ReportItem[] = [];
  for (const item of items) {
    const sent = item.id === sentId;
    if (item.body.kind === "edit") {
      const previous = report[report.length - 1];
      if (
        previous !== undefined &&
        previous.kind === "edits" &&
        previous.version === item.body.version &&
        previous.sent === sent
      ) {
        continue;
      }
      report.push({ kind: "edits", version: item.body.version, sent });
    } else {
      report.push({ kind: item.body.kind, maybeRan: sent && sentMayHaveRun });
    }
  }
  return report;
}

function backoff(attempt: number): number {
  if (attempt <= 0) {
    return 0;
  }
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
}

/**
 * Check I1-I3 on a client's internals; throws naming the first that fails.
 * I4 and I5 are properties of how messages and edits are handled, not of
 * state, and are covered by tests instead.
 */
export function assertSyncInvariants(internals: SyncClientInternals): void {
  const { inflight, queue, server, local } = internals;
  if (inflight !== null) {
    check(Number.isSafeInteger(inflight.seq) && inflight.seq > 0, "I1: the in-flight item has a positive seq");
    check(inflight.seq === internals.nextSeq - 1, "I1: the in-flight item holds the newest seq");
  }
  for (const item of queue) {
    check(!("seq" in item), "I1: a queued item has no seq");
  }
  const pending = inflight === null ? queue : [inflight, ...queue];
  if (server === null) {
    check(local === null && pending.length === 0, "I2: nothing is local or pending before the scene loads");
  } else {
    check(local !== null, "I2: a loaded scene has local documents");
    const expected = localOf(
      server.docs,
      pending.map((item) => item.body)
    );
    for (const version of VERSIONS) {
      check(sameValue(local![version], expected[version]), `I2: local ${version} is the server's plus pending edits`);
    }
  }
  const ids = pending.map((item) => item.id);
  check(new Set(ids).size === ids.length, "I3: each pending item is pending once");
  check(
    sameValue(
      [...ids].sort((a, b) => a - b),
      [...internals.liveItemIds].sort((a, b) => a - b)
    ),
    "I3: the live items are exactly the pending ones"
  );
  check(internals.created === internals.left + ids.length, "I3: every item created has left or is pending");
}

function check(condition: boolean, invariant: string): void {
  if (!condition) {
    throw new Error(`scene sync invariant violated: ${invariant}`);
  }
}

function assert(condition: boolean, invariant: string): asserts condition {
  if (!condition) {
    throw new Error(`scene sync client invariant violated: ${invariant}`);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
