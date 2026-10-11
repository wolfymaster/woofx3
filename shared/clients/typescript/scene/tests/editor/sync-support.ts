// A real sync client against the pure sequencer, behind an in-memory network
// that delivers in order. The server is the smallest shell around the
// sequencer that keeps the protocol's rules, trimmed from the sync layer's
// own tests (api/tests/scene-editor/sync.test.ts), which are not importable
// without running them.

import {
  SceneSyncClient,
  type SyncClock,
  type SyncReport,
  type SyncSocket,
  type SyncSocketHandlers,
} from "../../../api/scene-editor/client";
import type { SceneDocument, Version } from "../../../api/scene-editor/document";
import { decodeClientMessage, type ItemBody, type ServerMessage } from "../../../api/scene-editor/protocol";
import {
  commit,
  createSequencerState,
  decideDuplicate,
  decideWelcome,
  prepare,
  recordRefusal,
  type SequencerState,
  watermarkOf,
} from "../../../api/scene-editor/sequencer";

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

/** A clock that moves only when told, running due timers in order. */
export class ManualClock implements SyncClock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, ms), callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      let due: [number, { at: number; callback: () => void }] | null = null;
      for (const entry of this.timers) {
        if (entry[1].at <= end && (due === null || entry[1].at < due[1].at)) {
          due = entry;
        }
      }
      if (due === null) {
        break;
      }
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].callback();
      await flush();
    }
    this.time = end;
    await flush();
  }
}

interface Link {
  handlers: SyncSocketHandlers;
  toServer: string[];
  toClient: string[];
  opened: boolean;
  closed: boolean;
  clientId: string | null;
  welcomed: boolean;
}

export class MiniServer {
  readonly state: SequencerState;
  readonly links: Link[] = [];
  /** Refuse an item as `invalid` when this returns a reason. */
  refuse: ((body: ItemBody) => string | null) | null = null;

  constructor(
    private readonly clock: ManualClock,
    doc: SceneDocument
  ) {
    const docs: Record<Version, SceneDocument> = { draft: structuredClone(doc), published: structuredClone(doc) };
    this.state = createSequencerState({
      docs,
      hasDraft: false,
      editorState: { v: 0, headId: "", clients: {} },
      epoch: "e1",
    });
  }

  connect = (_url: string, handlers: SyncSocketHandlers): SyncSocket => {
    const link: Link = {
      handlers,
      toServer: [],
      toClient: [],
      opened: false,
      closed: false,
      clientId: null,
      welcomed: false,
    };
    this.links.push(link);
    return {
      send: (text) => {
        if (!link.closed) {
          link.toServer.push(text);
        }
      },
      close: () => {
        link.closed = true;
      },
    };
  };

  async run(): Promise<void> {
    for (let moved = true; moved; ) {
      moved = false;
      for (const link of [...this.links]) {
        if (link.closed) {
          continue;
        }
        if (!link.opened) {
          link.opened = true;
          link.handlers.onOpen();
          moved = true;
        }
        const incoming = link.toServer.splice(0);
        for (const text of incoming) {
          this.receive(link, text);
        }
        const outgoing = link.toClient.splice(0);
        for (const text of outgoing) {
          if (!link.closed) {
            link.handlers.onMessage(text);
          }
        }
        moved = moved || incoming.length > 0 || outgoing.length > 0;
      }
      await flush();
    }
  }

  private send(link: Link, message: ServerMessage): void {
    if (!link.closed) {
      link.toClient.push(JSON.stringify(message));
    }
  }

  private receive(link: Link, text: string): void {
    const message = decodeClientMessage(text);
    if (message === null) {
      this.send(link, { type: "error", code: "protocol", detail: "not protocol 2" });
      return;
    }
    if (message.type === "hello") {
      link.clientId = message.clientId;
      const decision = decideWelcome(this.state, message.have);
      const base = {
        type: "welcome" as const,
        protocol: 2 as const,
        features: [],
        clientId: message.clientId,
        last: watermarkOf(this.state, message.clientId),
      };
      if (decision.kind === "catchup") {
        this.send(link, { ...base, catchup: decision.entries });
      } else {
        this.send(link, {
          ...base,
          snapshot: {
            v: this.state.v,
            id: this.state.headId,
            docs: this.state.docs,
            meta: { draft: {}, published: {} },
            hasDraft: this.state.hasDraft,
            name: "Scene",
          },
          diverged: decision.diverged,
        });
      }
      link.welcomed = true;
      return;
    }
    if (link.clientId === null || message.type === "presence") {
      return;
    }
    const src = { clientId: link.clientId, seq: message.seq };
    const duplicate = decideDuplicate(this.state, src);
    if (duplicate !== null) {
      this.send(link, duplicate);
      return;
    }
    const refusal = this.refuse?.(message.body) ?? null;
    if (refusal !== null) {
      this.send(
        link,
        recordRefusal(this.state, src, { refused: true, code: "invalid", detail: refusal }, this.clock.now())
      );
      return;
    }
    const result = prepare(this.state, message.base, message.body);
    if (result.refused) {
      this.send(link, recordRefusal(this.state, src, result, this.clock.now()));
      return;
    }
    const entry = commit(this.state, result, {}, src, this.clock.now());
    if (entry === null) {
      this.send(link, { type: "ack", seq: src.seq, v: this.state.v });
      return;
    }
    for (const other of this.links) {
      if (other.welcomed) {
        this.send(other, { type: "entry", ...entry });
      }
    }
  }
}

export interface SyncWorld {
  clock: ManualClock;
  server: MiniServer;
  reports: SyncReport[];
  client(name: string): SceneSyncClient;
  /** Deliver everything and let timers run, long enough for every queued item to go out. */
  quiet(ms?: number): Promise<void>;
}

export function syncWorld(doc: SceneDocument): SyncWorld {
  const clock = new ManualClock();
  const server = new MiniServer(clock, doc);
  const reports: SyncReport[] = [];
  return {
    clock,
    server,
    reports,
    client(name) {
      const client = new SceneSyncClient({
        open: async () => "ws://engine/scene/s/edit?protocol=2",
        connect: server.connect,
        clock,
        newClientId: () => name,
        name,
        onReport: (report) => reports.push(report),
      });
      client.start();
      return client;
    },
    async quiet(ms = 2_000) {
      for (let elapsed = 0; elapsed < ms; elapsed += 50) {
        await server.run();
        await clock.advance(50);
      }
      await server.run();
    },
  };
}
