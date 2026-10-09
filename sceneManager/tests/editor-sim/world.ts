// A deterministic world for the scene editor: the real SceneDocuments and
// editor route, N real SceneSyncClients, and everything between them faked
// on one virtual clock — the network, the database, framing, restarts and
// crashes. Every source of nondeterminism is a seeded PRNG, every wait is a
// timer on the virtual clock, and all promise callbacks run to completion
// between two events, so a seed replays exactly.

import {
  assertSyncInvariants,
  type ConnectSocket,
  type Entry,
  type SceneDocument,
  SceneSyncClient,
  type SyncClock,
  type SyncReport,
  type SyncSocket,
  type SyncSocketHandlers,
  sameValue,
  type Version,
  zKey,
} from "@woofx3/api/scene-editor";
import type { ServerWebSocket, WebSocketHandler } from "bun";
import { type EditorSocketData, editorSocketData, editorSocketHandlers } from "../../src/routes/editor";
import {
  SceneDocuments,
  type SceneDocumentsClock,
  type SceneWrite,
  storedSceneOf,
} from "../../src/scene/scene-documents";
import type { SessionTokenService } from "../../src/scene/session-token";
import { applyWrite, FakeSceneStore, type SceneRow, sceneRow, storedPlacement } from "../scene/fake-scene-store";

export const SCENE_ID = "s1";
const SHARED = "shared";

// ---------------------------------------------------------------------------
// Randomness and time

/** mulberry32: small, fast, and the same everywhere. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("pick from nothing");
    }
    return items[Math.floor(this.next() * items.length)]!;
  }
}

interface Scheduled {
  at: number;
  order: number;
  run: () => void;
  cancelled: boolean;
}

/** Discrete events on a virtual clock, earliest first, ties in the order they were scheduled. */
export class Scheduler {
  now = 0;
  steps = 0;
  private order = 0;
  private readonly heap: Scheduled[] = [];

  at(delay: number, run: () => void): Scheduled {
    const event: Scheduled = { at: this.now + Math.max(0, delay), order: this.order++, run, cancelled: false };
    this.heap.push(event);
    this.up(this.heap.length - 1);
    return event;
  }

  /** Run the next event and every promise callback it sets off. False when nothing is scheduled. */
  async step(): Promise<boolean> {
    for (;;) {
      const event = this.pop();
      if (event === undefined) {
        return false;
      }
      if (event.cancelled) {
        continue;
      }
      this.now = event.at;
      this.steps++;
      event.run();
      await drain();
      return true;
    }
  }

  nextAt(): number | null {
    while (this.heap.length > 0 && this.heap[0]!.cancelled) {
      this.pop();
    }
    return this.heap.length > 0 ? this.heap[0]!.at : null;
  }

  private less(a: Scheduled, b: Scheduled): boolean {
    return a.at < b.at || (a.at === b.at && a.order < b.order);
  }

  private up(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(this.heap[i]!, this.heap[parent]!)) {
        break;
      }
      [this.heap[i], this.heap[parent]] = [this.heap[parent]!, this.heap[i]!];
      i = parent;
    }
  }

  private pop(): Scheduled | undefined {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (top === undefined || last === undefined || top === last) {
      return top;
    }
    this.heap[0] = last;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let least = i;
      if (left < this.heap.length && this.less(this.heap[left]!, this.heap[least]!)) {
        least = left;
      }
      if (right < this.heap.length && this.less(this.heap[right]!, this.heap[least]!)) {
        least = right;
      }
      if (least === i) {
        break;
      }
      [this.heap[i], this.heap[least]] = [this.heap[least]!, this.heap[i]!];
      i = least;
    }
    return top;
  }
}

/** Every pending promise callback runs before the next macrotask. */
function drain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** One process's timers: killing it cancels them and ignores any it would set later. */
class ProcessClock implements SyncClock, SceneDocumentsClock {
  private alive = true;
  private readonly timers = new Set<Scheduled>();

  constructor(private readonly scheduler: Scheduler) {}

  now(): number {
    return this.scheduler.now;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    if (!this.alive) {
      return null;
    }
    const event = this.scheduler.at(ms, () => {
      this.timers.delete(event);
      callback();
    });
    this.timers.add(event);
    return event;
  }

  clearTimeout(handle: unknown): void {
    if (handle !== null && handle !== undefined) {
      (handle as Scheduled).cancelled = true;
      this.timers.delete(handle as Scheduled);
    }
  }

  kill(): void {
    this.alive = false;
    for (const event of this.timers) {
      event.cancelled = true;
    }
    this.timers.clear();
  }
}

// ---------------------------------------------------------------------------
// Network

interface Delivery {
  at: number;
  event: Scheduled;
}

/**
 * One socket between a client and the server: two FIFO channels with random
 * latency, never reordered. A cut delivers a random prefix of what is in
 * flight each way, then closes both ends (the server's close may lag).
 */
class Link {
  readonly id: number;
  readonly ws: ServerWebSocket<EditorSocketData>;
  private readonly toServer: Delivery[] = [];
  private readonly toClient: Delivery[] = [];
  private lastToServer = 0;
  private lastToClient = 0;
  /** No more sends are carried in either direction. */
  private down = false;
  private serverClosed = false;
  private clientClosed = false;
  private serverHeard = false;

  constructor(
    private readonly world: World,
    readonly server: ServerInstance | null,
    readonly clientHandlers: SyncSocketHandlers,
    readonly owner: SimClient
  ) {
    this.id = world.nextLinkId++;
    const data = editorSocketData(SCENE_ID);
    this.ws = {
      data,
      send: (text: string) => {
        this.fromServer(text);
        return 0;
      },
      close: (code?: number, reason?: string) => {
        this.serverClose(code ?? 1000, reason ?? "");
      },
    } as unknown as ServerWebSocket<EditorSocketData>;
  }

  /** The client side of the socket, as SceneSyncClient sees it. */
  clientSocket(): SyncSocket {
    return {
      send: (text) => this.fromClient(text),
      close: (code) => this.clientClose(code),
    };
  }

  open(): void {
    const server = this.server;
    if (server === null) {
      this.down = true;
      this.world.scheduler.at(this.world.latency(), () => this.clientHandlers.onClose(1006, ""));
      return;
    }
    this.world.scheduler.at(this.world.latency(), () => {
      if (this.down) {
        return;
      }
      if (!server.alive) {
        this.down = true;
        this.clientHandlers.onClose(1006, "");
        return;
      }
      server.links.add(this);
      this.clientHandlers.onOpen();
    });
  }

  private fromClient(text: string): void {
    if (this.down || this.clientClosed) {
      return;
    }
    this.world.trace(`c${this.owner.slot}#${this.id} -> ${summarize(text)}`);
    this.push(this.toServer, "toServer", () => {
      if (this.serverClosed || this.server === null || !this.server.alive) {
        return;
      }
      this.server.handlers.message!(this.ws, text);
    });
  }

  private fromServer(text: string): void {
    if (this.down || this.serverClosed) {
      return;
    }
    this.world.observeServerMessage(this.owner, text);
    this.push(this.toClient, "toClient", () => {
      if (this.clientClosed) {
        return;
      }
      this.world.beforeClientReceives(this.owner, text);
      this.world.trace(`c${this.owner.slot}#${this.id} <- ${summarize(text)}`);
      this.clientHandlers.onMessage(text);
    });
  }

  private push(channel: Delivery[], which: "toServer" | "toClient", deliver: () => void): void {
    const last = which === "toServer" ? this.lastToServer : this.lastToClient;
    const at = Math.max(last, this.world.scheduler.now + this.world.latency());
    if (which === "toServer") {
      this.lastToServer = at;
    } else {
      this.lastToClient = at;
    }
    const delivery: Delivery = {
      at,
      event: this.world.scheduler.at(at - this.world.scheduler.now, () => {
        channel.shift();
        deliver();
      }),
    };
    channel.push(delivery);
  }

  /** The server closed this socket: the close follows what it already sent. */
  private serverClose(code: number, reason: string): void {
    if (this.serverClosed || this.down) {
      return;
    }
    this.serverClosed = true;
    this.push(this.toClient, "toClient", () => {
      this.finish(code, reason);
    });
  }

  /** The client closed this socket: the server hears it after what the client already sent. */
  private clientClose(code: number): void {
    if (this.clientClosed || this.down) {
      return;
    }
    this.clientClosed = true;
    this.push(this.toServer, "toServer", () => {
      this.down = true;
      this.serverHearsClose(code);
    });
  }

  private finish(code: number, reason: string): void {
    this.down = true;
    if (!this.clientClosed) {
      this.clientClosed = true;
      this.clientHandlers.onClose(code, reason);
    }
    this.world.scheduler.at(this.world.rng.int(0, 50), () => this.serverHearsClose(code));
  }

  private serverHearsClose(code: number): void {
    const server = this.server;
    if (this.serverHeard || server === null || !server.links.delete(this)) {
      return;
    }
    this.serverHeard = true;
    if (server.alive) {
      server.handlers.close?.(this.ws, code, "");
    }
  }

  /** The network drops: a random prefix of each channel still arrives, then both ends close. */
  cut(): void {
    if (this.down) {
      return;
    }
    this.down = true;
    const keep = (channel: Delivery[]) => {
      const kept = this.world.rng.int(0, channel.length);
      for (const delivery of channel.slice(kept)) {
        delivery.event.cancelled = true;
      }
      channel.splice(kept);
      return channel.length > 0 ? channel[channel.length - 1]!.at : this.world.scheduler.now;
    };
    const clientAt = keep(this.toClient);
    const serverAt = keep(this.toServer);
    this.world.scheduler.at(clientAt - this.world.scheduler.now + 1, () => {
      if (!this.clientClosed) {
        this.clientClosed = true;
        this.clientHandlers.onClose(1006, "");
      }
    });
    this.world.scheduler.at(serverAt - this.world.scheduler.now + this.world.rng.int(1, 200), () => {
      this.serverHearsClose(1006);
    });
  }
}

function summarize(text: string): string {
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

// ---------------------------------------------------------------------------
// Server

class ServerInstance {
  readonly clock: ProcessClock;
  readonly docs: SceneDocuments;
  readonly handlers: WebSocketHandler<EditorSocketData>;
  readonly links = new Set<Link>();
  alive = true;
  private loads = 0;
  /** Each version's last overlay sequence number, to check they count up by one. */
  private readonly overlaySeq: Record<Version, number> = { draft: 0, published: 0 };

  constructor(
    private readonly world: World,
    readonly generation: number
  ) {
    this.clock = new ProcessClock(world.scheduler);
    this.docs = new SceneDocuments(
      world.store,
      {
        broadcast: (_sceneId, _event, data) => this.overlayEvent(data as { version: Version; seq: number }),
        connectedSceneIds: () => [],
      },
      world.logger,
      { persister: world.store, clock: this.clock, newEpoch: () => `g${generation}l${++this.loads}` }
    );
    this.handlers = editorSocketHandlers({
      sessionTokens: null as unknown as SessionTokenService,
      sceneDocuments: this.docs,
      logger: world.logger,
    });
  }

  /** The sequencer state of the held scene, read through the documents' internals. */
  held(): HeldView | undefined {
    return (this.docs as unknown as { scenes: Map<string, HeldView> }).scenes.get(SCENE_ID);
  }

  private overlayEvent(event: { version: Version; seq: number }): void {
    check(
      event.seq === this.overlaySeq[event.version] + 1,
      `overlay ${event.version} seq ${event.seq} follows ${this.overlaySeq[event.version]}`
    );
    this.overlaySeq[event.version] = event.seq;
    const held = this.held();
    const last = held?.state.log[held.state.log.length - 1];
    if (held !== undefined && last?.kind === "publish") {
      check(
        sameValue(held.state.docs.published, held.state.docs.draft),
        "a publish leaves published equal to the draft"
      );
    }
  }
}

interface HeldView {
  state: {
    v: number;
    headId: string;
    docs: Record<Version, SceneDocument>;
    hasDraft: boolean;
    log: Entry[];
    clients: Map<string, { seq: number; outcome: string }>;
  };
}

// ---------------------------------------------------------------------------
// Clients

export class SimClient {
  readonly client: SceneSyncClient;
  readonly reports: SyncReport[] = [];
  /** Placements this client added and may still delete. */
  readonly added: string[] = [];
  private nextAdded = 0;

  constructor(
    private readonly world: World,
    readonly slot: number,
    readonly generation: number
  ) {
    const connect: ConnectSocket = (_url, handlers) => world.connect(this, handlers);
    this.client = new SceneSyncClient({
      open: () => world.openSession(),
      connect,
      clock: world.clientClock,
      newClientId: () => `c${slot}.${generation}`,
      name: `Editor ${slot}`,
      onReport: (report) => {
        this.reports.push(report);
        world.trace(`c${slot} report ${JSON.stringify(report)}`);
      },
    });
  }

  get id(): string {
    return this.client.id;
  }

  newPlacementId(): string {
    return `n${this.slot}.${this.generation}.${this.nextAdded++}`;
  }
}

// ---------------------------------------------------------------------------
// The world

export interface WorldOptions {
  seed: number;
  clients: number;
  /** Scheduler steps of chaos before healing. */
  events: number;
  /** How many trace lines to keep for a failure report. */
  traceLines: number;
}

export class World {
  readonly rng: Rng;
  readonly scheduler = new Scheduler();
  readonly clientClock: ProcessClock;
  readonly store: FakeSceneStore;
  readonly logger = { debug() {}, info() {}, warn() {}, error() {} } as never;
  server: ServerInstance | null;
  readonly clients: SimClient[] = [];
  nextLinkId = 1;
  private serverGeneration = 0;
  private readonly traceLines: string[] = [];
  private nextToken = 0;

  /** Chaos is on: failures, cuts, restarts. */
  chaos = true;
  crashed = false;
  externalSaved = false;
  /** A client took a snapshot welcome holding unsent text: text edits merge last-writer-wins there. */
  lossyRebase = false;
  /** Tokens the server committed, by the entry that carried them. */
  readonly committedTokens = new Set<string>();
  sawInvalidNack = false;
  readonly restarts = { graceful: 0, crash: 0 };
  /** A write failed while a graceful restart was writing everything back. */
  shutdownWriteFailed = false;
  private restarting = false;

  constructor(readonly options: WorldOptions) {
    this.rng = new Rng(options.seed);
    this.clientClock = new ProcessClock(this.scheduler);
    const placements = [
      storedPlacement(SHARED, { settings: { text: "" }, zIndex: 0 }),
      ...Array.from({ length: options.clients }, (_, slot) =>
        storedPlacement(`p${slot}`, { zIndex: slot + 1, settings: { text: "" } })
      ),
    ];
    const row: SceneRow = sceneRow(SCENE_ID, placements, { width: 1920, height: 1080 });
    this.store = new FakeSceneStore([row], {
      beforeRead: () => this.dbStep(0.05),
      beforeWrite: (write) => this.dbWrite(write),
      beforeFrame: () => this.dbStep(0.1),
    });
    this.server = this.startServer();
    for (let slot = 0; slot < options.clients; slot++) {
      this.addClient(slot, 0);
    }
  }

  // -- tracing ---------------------------------------------------------------

  trace(line: string): void {
    this.traceLines.push(`${String(this.scheduler.now).padStart(7)} ${line}`);
    if (this.traceLines.length > this.options.traceLines) {
      this.traceLines.splice(0, this.traceLines.length - 400);
    }
  }

  traceTail(): string {
    return this.traceLines.join("\n");
  }

  // -- infrastructure --------------------------------------------------------

  latency(): number {
    return this.rng.int(1, this.chaos ? 120 : 20);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.scheduler.at(ms, resolve));
  }

  private async dbStep(failure: number): Promise<void> {
    await this.sleep(this.rng.int(1, 80));
    if (this.chaos && this.rng.chance(failure)) {
      throw new Error("injected database failure");
    }
  }

  private async dbWrite(write: SceneWrite): Promise<void> {
    try {
      await this.dbStep(0.1);
    } catch (err) {
      if (this.restarting) {
        this.shutdownWriteFailed = true;
      }
      throw err;
    }
    // The db publishes `scene.updated` for every write; sceneManager hears it later.
    this.scheduler.at(this.rng.int(5, 200), () => {
      void this.server?.docs.refresh(SCENE_ID);
    });
    this.trace(`db write ${write.editorStateJson ? JSON.parse(write.editorStateJson).headId : "-"}`);
  }

  private startServer(): ServerInstance {
    const server = new ServerInstance(this, ++this.serverGeneration);
    this.trace(`server g${server.generation} up`);
    return server;
  }

  async openSession(): Promise<string | null> {
    await this.sleep(this.rng.int(1, 60));
    if (this.server === null) {
      if (this.rng.chance(0.3)) {
        throw new Error("the api did not answer");
      }
      return null;
    }
    return `ws://scene-manager/scene/${SCENE_ID}/edit?protocol=2`;
  }

  connect(owner: SimClient, handlers: SyncSocketHandlers): SyncSocket {
    const link = new Link(this, this.server, handlers, owner);
    link.open();
    return link.clientSocket();
  }

  observeServerMessage(_owner: SimClient, text: string): void {
    const message = JSON.parse(text) as { type: string; code?: string; changes?: Entry["changes"] };
    if (message.type === "nack" && message.code === "invalid") {
      this.sawInvalidNack = true;
    }
    if (message.type === "entry") {
      for (const component of message.changes?.published ?? []) {
        if (typeof component.si === "string") {
          for (const token of tokensIn(component.si)) {
            this.committedTokens.add(token);
          }
        }
      }
    }
  }

  beforeClientReceives(owner: SimClient, text: string): void {
    if (!text.includes('"snapshot"')) {
      return;
    }
    const internals = owner.client.inspect();
    const pending = [internals.inflight, ...internals.queue].filter((item) => item !== null);
    if (pending.some((item) => item!.body.kind === "edit" && JSON.stringify(item!.body.ops).includes('"text"'))) {
      this.lossyRebase = true;
    }
  }

  // -- clients ---------------------------------------------------------------

  private addClient(slot: number, generation: number): SimClient {
    const sim = new SimClient(this, slot, generation);
    this.clients[slot] = sim;
    sim.client.start();
    return sim;
  }

  /** A client whose editor closed for good is replaced by a fresh one, as a remount does. */
  private replaceClosed(): void {
    for (const sim of [...this.clients]) {
      const conn = sim.client.getState().conn;
      if (conn === "closed" && this.rng.chance(0.5)) {
        this.addClient(sim.slot, sim.generation + 1);
        this.trace(`c${sim.slot} remounted as ${this.clients[sim.slot]!.id}`);
      }
    }
  }

  // -- actions ---------------------------------------------------------------

  /** One random thing a user, the network, the database or the host does. */
  act(): void {
    const roll = this.rng.next();
    const sim = this.rng.pick(this.clients);
    const client = sim.client;
    const state = client.getState();
    const editing = state.local !== null && !state.stopping && state.conn !== "closed" && state.conn !== "gone";
    if (roll < 0.22 && editing) {
      this.editPrivate(sim);
    } else if (roll < 0.36 && editing) {
      this.editContended(sim);
    } else if (roll < 0.52 && editing) {
      this.typeToken(sim);
    } else if (roll < 0.58 && editing) {
      this.addOrDelete(sim);
    } else if (roll < 0.61 && editing && state.pendingCommand === null) {
      const command = this.rng.chance(0.6) ? "publish" : "discard";
      this.trace(`c${sim.slot} ${command}`);
      if (command === "publish") {
        client.publish();
      } else {
        client.discard();
      }
    } else if (roll < 0.66 && editing) {
      const selection = this.rng.pick([null, SHARED, `p${sim.slot}`]);
      client.setPresence(selection, this.rng.pick(["draft", "published"] as const));
    } else if (roll < 0.7) {
      if (state.stopping) {
        this.trace(`c${sim.slot} resume`);
        client.resume();
      } else if (state.conn !== "closed" && state.conn !== "gone") {
        this.trace(`c${sim.slot} stop`);
        client.stop();
      } else {
        this.replaceClosed();
      }
    } else if (roll < 0.76 && this.chaos) {
      const links = this.server === null ? [] : [...this.server.links];
      if (links.length > 0) {
        const link = this.rng.pick(links);
        this.trace(`cut c${link.owner.slot}#${link.id}`);
        link.cut();
      }
    } else if (roll < 0.78 && this.chaos) {
      this.externalSave();
    } else if (roll < 0.785 && this.chaos && this.server !== null && !this.restarting) {
      void this.restart(this.rng.chance(0.5) ? "graceful" : "crash");
    }
  }

  private edit(sim: SimClient, version: Version, update: (doc: SceneDocument) => SceneDocument, what: string): void {
    const result = sim.client.edit(version, update);
    this.trace(`c${sim.slot} edit ${version} ${what}${result.ok ? "" : ` refused: ${result.detail}`}`);
  }

  private editPrivate(sim: SimClient): void {
    const version: Version = this.rng.chance(0.7) ? "draft" : "published";
    const local = sim.client.getState().local![version];
    const own = [`p${sim.slot}`, ...sim.added].filter((id) => local.widgets[id] !== undefined);
    if (own.length === 0) {
      return;
    }
    const id = this.rng.pick(own);
    const field = this.rng.pick(["x", "y", "width"] as const);
    const value = this.rng.int(0, 1000);
    this.edit(
      sim,
      version,
      (doc) => {
        doc.widgets[id]![field] = value;
        return doc;
      },
      `${id}.${field}=${value}`
    );
  }

  private editContended(sim: SimClient): void {
    const version: Version = this.rng.chance(0.5) ? "draft" : "published";
    const field = this.rng.pick(["x", "opacity", "visible"] as const);
    this.edit(
      sim,
      version,
      (doc) => {
        const shared = doc.widgets[SHARED]!;
        if (field === "x") {
          shared.x = this.rng.int(0, 1000);
        } else if (field === "opacity") {
          shared.opacity = this.rng.int(0, 10) / 10;
        } else {
          shared.visible = !shared.visible;
        }
        return doc;
      },
      `shared.${field}`
    );
  }

  /** Insert a unique token into the shared text on the published scene, between existing tokens. */
  private typeToken(sim: SimClient): void {
    const token = `[${sim.id}:${this.nextToken++}]`;
    this.edit(
      sim,
      "published",
      (doc) => {
        const text = String(doc.widgets[SHARED]!.settings.text ?? "");
        const boundaries = [0, ...[...text.matchAll(/\]/g)].map((match) => match.index! + 1)];
        const at = this.rng.pick(boundaries);
        doc.widgets[SHARED]!.settings = {
          ...doc.widgets[SHARED]!.settings,
          text: text.slice(0, at) + token + text.slice(at),
        };
        return doc;
      },
      `token ${token}`
    );
  }

  private addOrDelete(sim: SimClient): void {
    const draft = sim.client.getState().local!.draft;
    const present = sim.added.filter((id) => draft.widgets[id] !== undefined);
    if (present.length > 0 && this.rng.chance(0.4)) {
      const id = this.rng.pick(present);
      this.edit(
        sim,
        "draft",
        (doc) => {
          delete doc.widgets[id];
          return doc;
        },
        `delete ${id}`
      );
      return;
    }
    const id = sim.newPlacementId();
    sim.added.push(id);
    this.edit(
      sim,
      "draft",
      (doc) => {
        doc.widgets[id] = { ...doc.widgets[`p${sim.slot}`]!, z: zKey(Object.keys(doc.widgets).length), name: id };
        return doc;
      },
      `add ${id}`
    );
  }

  /** A save made elsewhere (the api): read, change the layout, write, all at once in the database. */
  private externalSave(): void {
    const row = this.store.rows.get(SCENE_ID)!;
    const layout = JSON.parse(row.layoutJson) as Record<string, unknown>;
    layout.background = `#${this.rng.int(0, 0xffffff).toString(16).padStart(6, "0")}`;
    applyWrite(row, { id: SCENE_ID, layoutJson: JSON.stringify(layout) });
    this.scheduler.at(this.rng.int(5, 200), () => {
      void this.server?.docs.refresh(SCENE_ID);
    });
    this.externalSaved = true;
    this.trace(`external save ${String(layout.background)}`);
  }

  /** A graceful restart writes everything and closes its sockets; a crash just stops. */
  async restart(how: "graceful" | "crash"): Promise<void> {
    const server = this.server;
    if (server === null || this.restarting) {
      return;
    }
    this.restarting = true;
    this.restarts[how]++;
    this.trace(`server g${server.generation} ${how}`);
    if (how === "graceful") {
      await server.docs.close();
      for (const link of [...server.links]) {
        link.ws.close(1001, "going away");
      }
    } else {
      this.crashed = true;
      for (const link of [...server.links]) {
        link.cut();
      }
    }
    server.alive = false;
    server.clock.kill();
    this.server = null;
    this.restarting = false;
    this.scheduler.at(this.rng.int(100, 3000), () => {
      if (this.server === null) {
        this.server = this.startServer();
      }
    });
  }

  // -- checks ----------------------------------------------------------------

  /** After every event: the client invariants and the server's log. */
  checkInvariants(): void {
    for (const sim of this.clients) {
      assertSyncInvariants(sim.client.inspect());
    }
    const held = this.server?.held();
    if (held === undefined) {
      return;
    }
    const { log, v, clients } = held.state;
    if (log.length > 0) {
      check(log[log.length - 1]!.v === v, "the log ends at the head");
    }
    const lastSeq = new Map<string, number>();
    log.forEach((entry, index) => {
      if (index > 0) {
        check(entry.v === log[index - 1]!.v + 1, "the log is contiguous");
      }
      if (entry.src !== null) {
        const previous = lastSeq.get(entry.src.clientId) ?? 0;
        check(entry.src.seq > previous, `${entry.src.clientId}'s items commit once, in seq order`);
        lastSeq.set(entry.src.clientId, entry.src.seq);
        const watermark = clients.get(entry.src.clientId);
        check(
          watermark !== undefined && watermark.seq >= entry.src.seq,
          "a committed item is under its client's watermark"
        );
      }
    });
  }

  // -- phases ----------------------------------------------------------------

  /** Random actions between scheduler steps, until `events` steps have run. */
  async runChaos(): Promise<void> {
    const actEvery = () => this.rng.int(10, 400);
    const loop = () => {
      if (!this.chaos) {
        return;
      }
      this.act();
      this.scheduler.at(actEvery(), loop);
    };
    this.scheduler.at(actEvery(), loop);
    const end = this.scheduler.steps + this.options.events;
    while (this.scheduler.steps < end) {
      if (!(await this.scheduler.step())) {
        break;
      }
      this.checkInvariants();
    }
  }

  /** Step the scheduler until `promise` settles. */
  private async until(promise: Promise<void>): Promise<void> {
    let done = false;
    let failure: unknown = null;
    promise.then(
      () => {
        done = true;
      },
      (err) => {
        done = true;
        failure = err;
      }
    );
    await drain();
    while (!done) {
      check(await this.scheduler.step(), "a restart finishes");
    }
    if (failure !== null) {
      throw failure;
    }
  }

  /** Stop the chaos, bring everything back, and run until every client drained. */
  async heal(limitMs: number): Promise<void> {
    this.chaos = false;
    this.trace("heal");
    if (this.server === null) {
      this.server = this.startServer();
    }
    for (const sim of this.clients) {
      if (sim.client.getState().stopping) {
        sim.client.resume();
      }
      const conn = sim.client.getState().conn;
      if (conn === "closed" || conn === "gone") {
        this.addClient(sim.slot, sim.generation + 1);
      }
    }
    const deadline = this.scheduler.now + limitMs;
    while (!this.settled()) {
      const next = this.scheduler.nextAt();
      check(next !== null, "something is still scheduled while clients are not settled");
      check(next! <= deadline, `clients settle within ${limitMs} ms of healing`);
      await this.scheduler.step();
      this.checkInvariants();
    }
    // Quiet a while longer: late presence, writes and refreshes.
    const quietUntil = this.scheduler.now + 5000;
    while ((this.scheduler.nextAt() ?? Number.POSITIVE_INFINITY) <= quietUntil) {
      await this.scheduler.step();
      this.checkInvariants();
    }
    check(this.settled(), "clients stay settled");
  }

  private settled(): boolean {
    const head = this.server?.held()?.state.v;
    return this.clients.every((sim) => {
      const state = sim.client.getState();
      const internals = sim.client.inspect();
      return (
        state.conn === "ready" &&
        !sim.client.hasPending() &&
        head !== undefined &&
        internals.server !== null &&
        internals.server.v === head
      );
    });
  }

  /** Every client shows what the server holds. */
  checkConverged(): void {
    const held = this.server?.held();
    check(held !== undefined, "the scene is held");
    for (const sim of this.clients) {
      const internals = sim.client.inspect();
      for (const version of ["draft", "published"] as const) {
        check(sameValue(internals.local![version], held!.state.docs[version]), `${sim.id} converged on ${version}`);
        check(
          sameValue(internals.server!.docs[version], held!.state.docs[version]),
          `${sim.id}'s confirmed ${version} is the server's`
        );
      }
      check(internals.server!.hasDraft === held!.state.hasDraft, `${sim.id} agrees on hasDraft`);
    }
  }

  /** Text tokens: none twice; none the server committed missing, unless the run explains the loss. */
  checkTokens(): void {
    const held = this.server!.held()!;
    const text = String(held.state.docs.published.widgets[SHARED]!.settings.text ?? "");
    const tokens = tokensIn(text);
    check(new Set(tokens).size === tokens.length, `no token appears twice: ${text}`);
    check(tokens.join("") === text, `the text is whole tokens: ${text}`);
    const lossExplained =
      this.lossyRebase || ((this.crashed || this.shutdownWriteFailed) && this.historyLostReported());
    if (!lossExplained) {
      const present = new Set(tokens);
      for (const token of this.committedTokens) {
        check(present.has(token), `committed token ${token} survives`);
      }
    }
  }

  historyLostReported(): boolean {
    return this.allReports().some((report) => report.reason === "history_lost");
  }

  allReports(): SyncReport[] {
    return this.clients.flatMap((sim) => sim.reports);
  }

  /** Reports say only what happened. */
  checkReports(): void {
    for (const report of this.allReports()) {
      check(report.reason !== "gone", "the scene is never reported gone");
      if (report.reason === "history_lost") {
        check(
          this.crashed || this.externalSaved || this.shutdownWriteFailed,
          "history is reported lost only after a crash, a save made elsewhere, or a failed write at shutdown"
        );
      }
    }
    check(!this.sawInvalidNack, "no client sends an item the server refuses as invalid");
  }

  /**
   * Restart gracefully and check the database holds exactly the documents
   * and head the server had; then let the clients come back and converge
   * again, with nothing reported lost.
   */
  async checkReload(): Promise<void> {
    const before = this.server!.held()!.state;
    const docs = structuredClone(before.docs);
    const head = { v: before.v, headId: before.headId, hasDraft: before.hasDraft };
    const reportsBefore = this.allReports().length;
    await this.until(this.restart("graceful"));
    const row = this.store.rows.get(SCENE_ID)!;
    check(row.widgetsJson === storedSceneOf(docs.published).widgetsJson, "the published scene is stored as held");
    check(row.layoutJson === storedSceneOf(docs.published).layoutJson, "the published layout is stored as held");
    if (head.hasDraft) {
      check(row.draftWidgetsJson === storedSceneOf(docs.draft).widgetsJson, "the draft is stored as held");
    } else {
      check(row.draftWidgetsJson === null, "no draft is stored");
    }
    const stored = JSON.parse(row.editorStateJson ?? "null") as { v: number; headId: string } | null;
    check(
      stored !== null && stored.v === head.v && stored.headId === head.headId,
      "the head is stored with the documents"
    );
    this.server = this.startServer();
    await this.heal(120_000);
    this.checkConverged();
    const reloaded = this.server.held()!.state.docs;
    for (const version of ["draft", "published"] as const) {
      check(
        storedSceneOf(reloaded[version]).widgetsJson === storedSceneOf(docs[version]).widgetsJson,
        `the reloaded ${version} is the stored one`
      );
    }
    for (const report of this.allReports().slice(reportsBefore)) {
      check(report.reason !== "history_lost", "a graceful restart loses no history");
    }
  }
}

export function tokensIn(text: string): string[] {
  return [...text.matchAll(/\[[^\]]*\]/g)].map((match) => match[0]);
}

export class SimulationFailure extends Error {}

function check(condition: boolean, property: string): asserts condition {
  if (!condition) {
    throw new SimulationFailure(property);
  }
}
