// Real clients against the pure sequencer, behind an in-memory network whose
// links deliver in order and can be cut part way. The server here is the
// smallest shell around the sequencer that keeps the protocol's rules: reply
// inside the same step as the decision, entries to every welcomed editor.

import { describe, expect, test } from "bun:test";
import {
  assertSyncInvariants,
  BACKOFF_BASE_MS,
  DRAIN_DEADLINE_MS,
  SceneSyncClient,
  type SyncReport,
  type SyncSocket,
  type SyncSocketHandlers,
} from "../../scene-editor/client";
import { type SceneDocument, sameValue } from "../../scene-editor/document";
import { CLOSE_CODES, decodeClientMessage, type ItemBody, nackOf, type ServerMessage } from "../../scene-editor/protocol";
import {
  commit,
  createSequencerState,
  decideDuplicate,
  decideWelcome,
  prepare,
  recordRefusal,
  type SequencerState,
  watermarkOf,
} from "../../scene-editor/sequencer";
import { bothDocs, flush, ManualClock, placement, sceneDoc } from "./test-support";

interface Link {
  handlers: SyncSocketHandlers;
  toServer: string[];
  toClient: string[];
  opened: boolean;
  closed: boolean;
  /** Made while the server was unreachable: it fails instead of opening. */
  failing: boolean;
  clientId: string | null;
  welcomed: boolean;
}

class MiniServer {
  readonly state: SequencerState;
  readonly links: Link[] = [];
  /** Items received, in order, as `clientId:seq`. */
  readonly received: string[] = [];
  /** Answer this many items with `unavailable` before deciding any. */
  unavailableFor = 0;
  /** Refuse an item as `invalid` when this returns a reason. */
  refuse: ((body: ItemBody) => string | null) | null = null;
  /** New links fail to open while set. */
  unreachable = false;

  constructor(
    private readonly clock: ManualClock,
    doc: SceneDocument
  ) {
    this.state = createSequencerState({
      docs: bothDocs(doc),
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
      failing: this.unreachable,
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

  /** Deliver everything in flight, both ways, until nothing moves. */
  async run(): Promise<void> {
    for (let moved = true; moved; ) {
      moved = false;
      for (const link of [...this.links]) {
        if (link.closed) {
          continue;
        }
        if (link.failing) {
          link.closed = true;
          link.handlers.onClose(1006, "");
          moved = true;
          continue;
        }
        if (!link.opened) {
          link.opened = true;
          link.handlers.onOpen();
          moved = true;
        }
        moved = this.flushToServer(link) || moved;
        moved = this.flushToClient(link) || moved;
      }
      await flush();
    }
  }

  flushToServer(link: Link): boolean {
    const messages = link.toServer.splice(0);
    for (const text of messages) {
      this.receive(link, text);
    }
    return messages.length > 0;
  }

  flushToClient(link: Link): boolean {
    const messages = link.toClient.splice(0);
    for (const text of messages) {
      if (!link.closed) {
        link.handlers.onMessage(text);
      }
    }
    return messages.length > 0;
  }

  /** Cut a link: what is still queued either way is lost. */
  cut(link: Link): void {
    link.toServer = [];
    link.toClient = [];
    link.closed = true;
    link.handlers.onClose(1006, "");
  }

  current(): Link {
    const link = [...this.links].reverse().find((candidate) => !candidate.closed);
    if (link === undefined) {
      throw new Error("no open link");
    }
    return link;
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
      for (const other of this.links) {
        if (other !== link && other.clientId === message.clientId && !other.closed) {
          other.closed = true;
          other.handlers.onClose(CLOSE_CODES.replaced, "replaced");
        }
      }
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
    if (link.clientId === null) {
      this.send(link, { type: "error", code: "protocol", detail: "hello first" });
      return;
    }
    if (message.type === "presence") {
      return;
    }
    const src = { clientId: link.clientId, seq: message.seq };
    this.received.push(`${src.clientId}:${src.seq}`);
    const duplicate = decideDuplicate(this.state, src);
    if (duplicate !== null) {
      this.send(link, duplicate);
      return;
    }
    if (this.unavailableFor > 0) {
      this.unavailableFor--;
      this.send(link, nackOf(src.seq, "unavailable", "storage is down"));
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

interface World {
  clock: ManualClock;
  server: MiniServer;
  reports: Map<string, SyncReport[]>;
  client(name: string): SceneSyncClient;
  quiet(ms?: number): Promise<void>;
}

function world(doc: SceneDocument = sceneDoc({ w: placement({ name: "ab" }) })): World {
  const clock = new ManualClock();
  const server = new MiniServer(clock, doc);
  const reports = new Map<string, SyncReport[]>();
  const clients: SceneSyncClient[] = [];
  return {
    clock,
    server,
    reports,
    client(name) {
      const list: SyncReport[] = [];
      reports.set(name, list);
      const client = new SceneSyncClient({
        open: async () => "ws://engine/scene/s/edit?protocol=2",
        connect: server.connect,
        clock,
        newClientId: () => name,
        name,
        onReport: (report) => list.push(report),
      });
      clients.push(client);
      client.start();
      return client;
    },
    async quiet(ms = 15_000) {
      for (let elapsed = 0; elapsed < ms; elapsed += 50) {
        await server.run();
        for (const client of clients) {
          assertSyncInvariants(client.inspect());
        }
        await clock.advance(50);
      }
      await server.run();
    },
  };
}

function expectConverged(server: MiniServer, ...clients: SceneSyncClient[]): void {
  for (const client of clients) {
    const local = client.getState().local;
    expect(local).not.toBeNull();
    expect(sameValue(local, server.state.docs)).toBe(true);
    expect(client.hasPending()).toBe(false);
  }
}

function committedSources(server: MiniServer): string[] {
  return server.state.log.flatMap((entry) => (entry.src === null ? [] : [`${entry.src.clientId}:${entry.src.seq}`]));
}

function appendName(text: string) {
  return (doc: SceneDocument): SceneDocument => {
    doc.widgets.w!.name += text;
    return doc;
  };
}

describe("client and sequencer", () => {
  test("concurrent editors converge, text from both kept", async () => {
    const w = world();
    const a = w.client("a");
    const b = w.client("b");
    await w.quiet(200);
    a.edit("draft", appendName("1"));
    b.edit("draft", appendName("2"));
    a.edit("published", (doc) => {
      doc.widgets.w!.x = 4;
      return doc;
    });
    b.edit("draft", (doc) => {
      doc.widgets.w!.x = 9;
      return doc;
    });
    await w.quiet();

    expectConverged(w.server, a, b);
    const name = w.server.state.docs.draft.widgets.w!.name;
    expect(name.includes("1") && name.includes("2")).toBe(true);
  });

  test("an item committed whose entry was lost is confirmed by the catch-up, not applied again", async () => {
    const w = world();
    const a = w.client("a");
    await w.quiet(200);
    a.edit("draft", appendName("!"));
    const link = w.server.current();
    w.server.flushToServer(link);
    w.server.cut(link);
    await w.quiet();

    expect(committedSources(w.server)).toEqual(["a:1"]);
    expect(w.server.state.docs.draft.widgets.w!.name).toBe("ab!");
    expectConverged(w.server, a);
  });

  test("an item lost before the server saw it is resent with the same seq and applied once", async () => {
    const w = world();
    const a = w.client("a");
    await w.quiet(200);
    a.edit("draft", appendName("!"));
    a.edit("draft", appendName("?"));
    w.server.cut(w.server.current());
    await w.quiet();

    expect(w.server.received[0]).toBe("a:1");
    expect(committedSources(w.server)).toEqual(["a:1", "a:2"]);
    expect(w.server.state.docs.draft.widgets.w!.name).toBe("ab!?");
    expectConverged(w.server, a);
  });

  test("publish includes every edit made before it, in one entry after them", async () => {
    const w = world();
    const a = w.client("a");
    await w.quiet(200);
    a.edit("draft", (doc) => {
      doc.widgets.w!.x = 1;
      return doc;
    });
    a.edit("published", (doc) => {
      doc.widgets.w!.height = 7;
      return doc;
    });
    a.edit("draft", (doc) => {
      doc.widgets.w!.y = 2;
      return doc;
    });
    a.publish();
    expect(a.getState().pendingCommand).toBe("publish");
    await w.quiet();

    const kinds = w.server.state.log.map((entry) => entry.kind);
    expect(kinds[kinds.length - 1]).toBe("publish");
    expect(w.server.state.docs.published.widgets.w).toMatchObject({ x: 1, y: 2, height: 7 });
    expect(w.server.state.hasDraft).toBe(false);
    expect(a.getState().pendingCommand).toBeNull();
    expectConverged(w.server, a);
  });

  test("edits queued after a discard survive on the reset draft", async () => {
    const w = world();
    const a = w.client("a");
    await w.quiet(200);
    a.edit("draft", (doc) => {
      doc.widgets.w!.x = 5;
      return doc;
    });
    a.discard();
    a.edit("draft", (doc) => {
      doc.widgets.w!.y = 7;
      return doc;
    });
    await w.quiet();

    expect(w.server.state.docs.draft.widgets.w).toMatchObject({ x: 0, y: 7 });
    expect(w.server.state.docs.published.widgets.w).toMatchObject({ x: 0, y: 0 });
    expect(w.server.state.hasDraft).toBe(true);
    expectConverged(w.server, a);
  });

  test("a refused edit is rolled back softly and reported; later edits are kept", async () => {
    const w = world();
    w.server.refuse = (body) =>
      body.kind === "edit" && body.ops.some((component) => component.oi === 666) ? "not allowed" : null;
    const a = w.client("a");
    await w.quiet(200);
    a.edit("draft", (doc) => {
      doc.widgets.w!.x = 666;
      return doc;
    });
    a.edit("draft", (doc) => {
      doc.widgets.w!.y = 7;
      return doc;
    });
    await w.quiet();

    expect(w.server.state.docs.draft.widgets.w).toMatchObject({ x: 0, y: 7 });
    expect(w.reports.get("a")).toEqual([
      { reason: "rejected", items: [{ kind: "edits", version: "draft", sent: true }], detail: "not allowed" },
    ]);
    expectConverged(w.server, a);
  });

  test("unavailable: the same seq is retried with backoff and applied once", async () => {
    const w = world();
    const a = w.client("a");
    await w.quiet(200);
    w.server.unavailableFor = 2;
    a.edit("draft", appendName("!"));
    await w.server.run();
    expect(a.getState().retrying).toBe(true);
    await w.quiet(3 * BACKOFF_BASE_MS + 500);

    expect(w.server.received).toEqual(["a:1", "a:1", "a:1"]);
    expect(committedSources(w.server)).toEqual(["a:1"]);
    expectConverged(w.server, a);
  });

  test("stop() drains what is pending, then closes without a report", async () => {
    const w = world();
    const a = w.client("a");
    await w.quiet(200);
    a.edit("draft", appendName("!"));
    a.publish();
    a.stop();
    await w.quiet(1000);

    expect(a.getState().conn).toBe("closed");
    expect(w.server.state.docs.published.widgets.w!.name).toBe("ab!");
    expect(w.reports.get("a")).toEqual([]);
  });

  test("stop() with the engine unreachable reports what was left at the deadline", async () => {
    const w = world();
    const a = w.client("a");
    await w.quiet(200);
    a.edit("draft", appendName("!"));
    a.publish();
    w.server.unreachable = true;
    w.server.cut(w.server.current());
    a.stop();
    await w.quiet(DRAIN_DEADLINE_MS + 100);

    expect(a.getState().conn).toBe("closed");
    expect(w.reports.get("a")).toEqual([
      {
        reason: "closed",
        items: [
          { kind: "edits", version: "draft", sent: true },
          { kind: "publish", maybeRan: false },
        ],
        detail: expect.any(String),
      },
    ]);
  });

  test("a client that missed more than the log holds rebases its pending edits onto a snapshot", async () => {
    const w = world();
    const a = w.client("a");
    const b = w.client("b");
    await w.quiet(200);
    a.edit("draft", (doc) => {
      doc.widgets.w!.x = 3;
      return doc;
    });
    w.server.cut(w.server.links.find((link) => link.clientId === "a" && !link.closed)!);
    w.server.unreachable = true;
    for (let i = 0; i < 1005; i++) {
      b.edit("draft", (doc) => {
        doc.layout.counter = i;
        return doc;
      });
      await w.server.run();
      await w.clock.advance(100);
    }
    w.server.unreachable = false;
    await w.quiet();

    expect(w.server.state.docs.draft.widgets.w!.x).toBe(3);
    expect(w.server.state.docs.draft.layout.counter).toBe(1004);
    expect(w.reports.get("a")).toEqual([]);
    expectConverged(w.server, a, b);
  });
  test("a snapshot that confirms the in-flight addition keeps the edits queued on top of it", async () => {
    const w = world();
    const a = w.client("a");
    const b = w.client("b");
    await w.quiet(200);
    a.edit("draft", (doc) => {
      doc.widgets.n = placement({ name: "new" });
      return doc;
    });
    a.edit("draft", (doc) => {
      doc.widgets.n!.x = 40;
      doc.widgets.n!.name = "newer";
      return doc;
    });
    const link = w.server.links.find((candidate) => candidate.clientId === "a" && !candidate.closed)!;
    w.server.flushToServer(link);
    w.server.cut(link);
    w.server.unreachable = true;
    for (let i = 0; i < 1005; i++) {
      b.edit("draft", (doc) => {
        doc.layout.counter = i;
        return doc;
      });
      await w.server.run();
      await w.clock.advance(100);
    }
    w.server.unreachable = false;
    await w.quiet();

    expect(w.server.received.filter((source) => source.startsWith("a:"))).toEqual(["a:1", "a:2"]);
    expect(committedSources(w.server).filter((source) => source.startsWith("a:"))).toEqual(["a:2"]);
    expect(w.server.state.docs.draft.widgets.n).toMatchObject({ x: 40, name: "newer" });
    expect(w.reports.get("a")).toEqual([]);
    expectConverged(w.server, a, b);
  });
});
