import { describe, expect, test } from "bun:test";
import {
  assertSyncInvariants,
  BACKOFF_BASE_MS,
  CLIENT_RESTART_CLOSE_CODE,
  DRAIN_DEADLINE_MS,
  SceneSyncClient,
  SEND_SPACING_MS,
  type SyncReport,
  type SyncSocket,
  type SyncSocketHandlers,
  UNAVAILABLE_RETRY_MS,
} from "./client";
import { type Entry, MAX_OPS_BYTES, type Ops, type SceneDocument, type Version } from "./document";
import {
  CLOSE_CODES,
  type ClientMessage,
  type HelloMessage,
  type ItemMessage,
  type ServerMessage,
  type Watermark,
} from "./protocol";
import { bothDocs, flush, ManualClock, placement, sceneDoc } from "./test-support";

class FakeSocket implements SyncSocket {
  readonly sent: ClientMessage[] = [];
  closed: { code: number; reason: string } | null = null;

  constructor(
    readonly url: string,
    private readonly handlers: SyncSocketHandlers
  ) {}

  send(text: string): void {
    this.sent.push(JSON.parse(text) as ClientMessage);
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  open(): void {
    this.handlers.onOpen();
  }

  deliver(message: ServerMessage | string): void {
    this.handlers.onMessage(typeof message === "string" ? message : JSON.stringify(message));
  }

  serverClose(code: number, reason = ""): void {
    this.handlers.onClose(code, reason);
  }

  items(): ItemMessage[] {
    return this.sent.filter((message): message is ItemMessage => message.type === "item");
  }

  hello(): HelloMessage {
    const hello = this.sent[0];
    if (hello?.type !== "hello") {
      throw new Error("no hello sent");
    }
    return hello;
  }
}

interface Harness {
  client: SceneSyncClient;
  clock: ManualClock;
  sockets: FakeSocket[];
  reports: SyncReport[];
  socket(): FakeSocket;
}

function harness(open: () => Promise<string | null> = async () => "ws://engine/scene/s/edit?protocol=2"): Harness {
  const clock = new ManualClock();
  const sockets: FakeSocket[] = [];
  const reports: SyncReport[] = [];
  const client = new SceneSyncClient({
    open,
    connect: (url, handlers) => {
      const socket = new FakeSocket(url, handlers);
      sockets.push(socket);
      return socket;
    },
    clock,
    newClientId: () => "me",
    name: "Me",
    onReport: (report) => reports.push(report),
  });
  return {
    client,
    clock,
    sockets,
    reports,
    socket: () => {
      const socket = sockets[sockets.length - 1];
      if (socket === undefined) {
        throw new Error("no socket");
      }
      return socket;
    },
  };
}

const START = sceneDoc({ w: placement({ name: "ab" }) });

function snapshotWelcome(
  docs: Record<Version, SceneDocument> = bothDocs(START),
  options: { v?: number; last?: Watermark | null; diverged?: boolean } = {}
): ServerMessage {
  const v = options.v ?? 0;
  return {
    type: "welcome",
    protocol: 2,
    features: [],
    clientId: "me",
    last: options.last ?? null,
    snapshot: {
      v,
      id: v === 0 ? "" : `s.${v}`,
      docs,
      meta: { draft: {}, published: {} },
      hasDraft: false,
      name: "Scene",
    },
    diverged: options.diverged ?? false,
  };
}

function catchupWelcome(entries: Entry[], last: Watermark | null = null): ServerMessage {
  return { type: "welcome", protocol: 2, features: [], clientId: "me", last, catchup: entries };
}

function entryOf(
  v: number,
  changes: Partial<Record<Version, Ops>>,
  src: { clientId: string; seq: number } | null = null,
  kind: Entry["kind"] = "edit"
): Entry {
  return { v, id: `s.${v}`, src, kind, changes, meta: {}, hasDraft: changes.draft !== undefined };
}

function setX(x: number) {
  return (doc: SceneDocument): SceneDocument => {
    doc.widgets.w!.x = x;
    return doc;
  };
}

function setY(y: number) {
  return (doc: SceneDocument): SceneDocument => {
    doc.widgets.w!.y = y;
    return doc;
  };
}

async function connected(h: Harness): Promise<void> {
  h.client.start();
  await flush();
  h.socket().open();
}

async function ready(h: Harness): Promise<void> {
  await connected(h);
  h.socket().deliver(snapshotWelcome());
}

/** Ready with draft `w.x = 1` in flight as seq 1. */
async function inflight(h: Harness): Promise<void> {
  await ready(h);
  h.client.edit("draft", setX(1));
}

/** Ready with draft `w.x = 1` in flight and `w.y = 2` queued. */
async function inflightAndQueued(h: Harness): Promise<void> {
  await inflight(h);
  h.client.edit("draft", setY(2));
}

/** Drop the socket and reconnect, stopping before the welcome. */
async function reconnecting(h: Harness, given: (h: Harness) => Promise<void>): Promise<void> {
  await given(h);
  h.socket().serverClose(1006);
  await h.clock.advance(0);
  h.socket().open();
}

/** Placement `w` as the client shows it in `version`. */
function localW(h: Harness, version: Version) {
  const widget = h.client.getState().local?.[version].widgets.w;
  if (widget === undefined) {
    throw new Error(`no local ${version} placement w`);
  }
  return widget;
}

interface Row {
  name: string;
  given: (h: Harness) => Promise<void>;
  message: ServerMessage | string;
  expectAfter: (h: Harness) => Promise<void> | void;
}

const rows: Row[] = [
  {
    name: "welcome snapshot: ready, documents adopted, hello asked for a snapshot",
    given: connected,
    message: snapshotWelcome(),
    expectAfter: (h) => {
      expect(h.socket().hello()).toMatchObject({ protocol: 2, clientId: "me", have: null, name: "Me" });
      expect(h.client.getState()).toMatchObject({ conn: "ready", name: "Scene", local: bothDocs(START) });
    },
  },
  {
    name: "welcome catch-up: entries applied in order, hello named the last entry",
    given: (h) => reconnecting(h, ready),
    message: catchupWelcome([entryOf(1, { draft: [{ p: ["widgets", "w", "x"], od: 0, oi: 4 }] })]),
    expectAfter: (h) => {
      expect(h.socket().hello().have).toEqual({ v: 0, id: "" });
      expect(localW(h, "draft").x).toBe(4);
      expect(h.client.inspect().server?.v).toBe(1);
    },
  },
  {
    name: "welcome catch-up holding the client's own entry: the in-flight item is confirmed, not resent",
    given: (h) => reconnecting(h, inflight),
    message: catchupWelcome(
      [entryOf(1, { draft: [{ p: ["widgets", "w", "x"], od: 0, oi: 1 }] }, { clientId: "me", seq: 1 })],
      {
        seq: 1,
        outcome: "applied",
      }
    ),
    expectAfter: (h) => {
      expect(h.client.hasPending()).toBe(false);
      expect(h.socket().items()).toEqual([]);
    },
  },
  {
    name: "welcome whose watermark has the in-flight item applied: confirmed, not resent",
    given: (h) => reconnecting(h, inflight),
    message: snapshotWelcome(bothDocs(sceneDoc({ w: placement({ name: "ab", x: 1 }) })), {
      v: 1,
      last: { seq: 1, outcome: "applied" },
    }),
    expectAfter: (h) => {
      expect(h.client.hasPending()).toBe(false);
      expect(h.socket().items()).toEqual([]);
      expect(localW(h, "draft").x).toBe(1);
    },
  },
  {
    name: "welcome whose watermark has the in-flight item rejected: rolled back and reported",
    given: (h) => reconnecting(h, inflightAndQueued),
    message: catchupWelcome([], { seq: 1, outcome: "rejected", code: "invalid" }),
    expectAfter: async (h) => {
      expect(h.client.getState().local?.draft.widgets.w).toMatchObject({ x: 0, y: 2 });
      expect(h.reports).toEqual([
        { reason: "rejected", items: [{ kind: "edits", version: "draft", sent: true }], detail: expect.any(String) },
      ]);
      await h.clock.advance(SEND_SPACING_MS);
      expect(h.socket().items()).toMatchObject([{ seq: 2, body: { kind: "edit" } }]);
    },
  },
  {
    name: "welcome snapshot with the in-flight item undecided: rebased onto the snapshot and resent with its seq",
    given: (h) => reconnecting(h, inflight),
    message: snapshotWelcome(bothDocs(sceneDoc({ w: placement({ name: "ab", y: 9 }) })), { v: 7 }),
    expectAfter: (h) => {
      expect(h.socket().items()).toEqual([
        {
          type: "item",
          seq: 1,
          base: 7,
          body: { kind: "edit", version: "draft", ops: [{ p: ["widgets", "w", "x"], od: 0, oi: 1 }] },
        },
      ]);
      expect(h.client.getState().local?.draft.widgets.w).toMatchObject({ x: 1, y: 9 });
    },
  },
  {
    name: "welcome snapshot that diverged: history loss reported",
    given: (h) => reconnecting(h, ready),
    message: snapshotWelcome(bothDocs(START), { v: 3, diverged: true }),
    expectAfter: (h) => {
      expect(h.reports).toEqual([{ reason: "history_lost", items: [] }]);
      expect(h.client.getState().conn).toBe("ready");
    },
  },
  {
    name: "remote entry: pending edits are transformed past it (the client's text lands first)",
    given: async (h) => {
      await ready(h);
      h.client.edit("draft", (doc) => {
        doc.widgets.w!.name = "aXb";
        return doc;
      });
    },
    message: {
      type: "entry",
      ...entryOf(1, { draft: [{ p: ["widgets", "w", "name", 1], si: "R" }] }, { clientId: "peer", seq: 1 }),
    },
    expectAfter: (h) => {
      expect(localW(h, "draft").name).toBe("aXRb");
      expect(h.client.inspect().inflight?.body).toEqual({
        kind: "edit",
        version: "draft",
        ops: [{ p: ["widgets", "w", "name", 1], si: "X" }],
      });
    },
  },
  {
    name: "own entry: the in-flight item is confirmed and the next one goes after the spacing",
    given: inflightAndQueued,
    message: {
      type: "entry",
      ...entryOf(1, { draft: [{ p: ["widgets", "w", "x"], od: 0, oi: 1 }] }, { clientId: "me", seq: 1 }),
    },
    expectAfter: async (h) => {
      expect(h.client.inspect().inflight).toBeNull();
      expect(h.socket().items()).toHaveLength(1);
      await h.clock.advance(SEND_SPACING_MS);
      expect(h.socket().items()[1]).toMatchObject({ seq: 2, base: 1 });
    },
  },
  {
    name: "own live edit entry: the mirror into the draft is applied as a remote change",
    given: async (h) => {
      await ready(h);
      h.client.edit("published", setX(3));
    },
    message: {
      type: "entry",
      ...entryOf(
        1,
        {
          published: [{ p: ["widgets", "w", "x"], od: 0, oi: 3 }],
          draft: [{ p: ["widgets", "w", "x"], od: 0, oi: 3 }],
        },
        { clientId: "me", seq: 1 }
      ),
    },
    expectAfter: (h) => {
      expect(localW(h, "draft").x).toBe(3);
      expect(localW(h, "published").x).toBe(3);
    },
  },
  {
    name: "entry with a gap: the session restarts on a snapshot",
    given: ready,
    message: { type: "entry", ...entryOf(2, { draft: [{ p: ["layout", "a"], oi: 1 }] }) },
    expectAfter: async (h) => {
      expect(h.sockets[0]!.closed?.code).toBe(CLIENT_RESTART_CLOSE_CODE);
      expect(h.client.getState().conn).toBe("offline");
      await h.clock.advance(0);
      h.socket().open();
      expect(h.socket().hello().have).toBeNull();
    },
  },
  {
    name: "ack for the in-flight item: confirmed",
    given: inflight,
    message: { type: "ack", seq: 1, v: 0 },
    expectAfter: (h) => {
      expect(h.client.hasPending()).toBe(false);
      expect(localW(h, "draft").x).toBe(0);
    },
  },
  {
    name: "ack for another seq: ignored",
    given: inflight,
    message: { type: "ack", seq: 7, v: 0 },
    expectAfter: (h) => {
      expect(h.client.inspect().inflight?.seq).toBe(1);
    },
  },
  {
    name: "ack at a head the client has not reached: the session restarts",
    given: inflight,
    message: { type: "ack", seq: 1, v: 3 },
    expectAfter: (h) => {
      expect(h.client.getState().conn).toBe("offline");
      expect(h.client.inspect().inflight?.seq).toBe(1);
    },
  },
  {
    name: "nack invalid: the edit is rolled back, later edits kept, and reported",
    given: inflightAndQueued,
    message: { type: "nack", seq: 1, code: "invalid", retryable: false, detail: "ops do not apply" },
    expectAfter: async (h) => {
      expect(h.client.getState().local?.draft.widgets.w).toMatchObject({ x: 0, y: 2 });
      expect(h.reports).toEqual([
        { reason: "rejected", items: [{ kind: "edits", version: "draft", sent: true }], detail: "ops do not apply" },
      ]);
      await h.clock.advance(SEND_SPACING_MS);
      expect(h.socket().items()[1]).toMatchObject({
        seq: 2,
        body: { ops: [{ p: ["widgets", "w", "y"], od: 0, oi: 2 }] },
      });
    },
  },
  {
    name: "nack for another seq: ignored",
    given: inflight,
    message: { type: "nack", seq: 9, code: "invalid", retryable: false, detail: "" },
    expectAfter: (h) => {
      expect(h.client.inspect().inflight?.seq).toBe(1);
      expect(h.reports).toEqual([]);
    },
  },
  {
    name: "nack stale_base: reconnect, naming the last entry",
    given: inflight,
    message: { type: "nack", seq: 1, code: "stale_base", retryable: true, detail: "" },
    expectAfter: async (h) => {
      expect(h.client.getState().conn).toBe("offline");
      await h.clock.advance(0);
      h.socket().open();
      expect(h.socket().hello().have).toEqual({ v: 0, id: "" });
    },
  },
  {
    name: "nack unavailable: the same seq is resent after the backoff",
    given: inflight,
    message: { type: "nack", seq: 1, code: "unavailable", retryable: true, detail: "db down" },
    expectAfter: async (h) => {
      expect(h.client.getState().retrying).toBe(true);
      await h.clock.advance(BACKOFF_BASE_MS - 1);
      expect(h.socket().items()).toHaveLength(1);
      await h.clock.advance(1);
      expect(
        h
          .socket()
          .items()
          .map((item) => item.seq)
      ).toEqual([1, 1]);
      h.socket().deliver({ type: "nack", seq: 1, code: "unavailable", retryable: true, detail: "db down" });
      await h.clock.advance(2 * BACKOFF_BASE_MS);
      expect(
        h
          .socket()
          .items()
          .map((item) => item.seq)
      ).toEqual([1, 1, 1]);
      expect(h.client.getState().retrying).toBe(false);
    },
  },
  {
    name: "error not_found: gone, with every pending item reported",
    given: inflightAndQueued,
    message: { type: "error", code: "not_found", detail: "no such scene" },
    expectAfter: (h) => {
      expect(h.client.getState().conn).toBe("gone");
      expect(h.reports).toEqual([
        {
          reason: "gone",
          items: [
            { kind: "edits", version: "draft", sent: true },
            { kind: "edits", version: "draft", sent: false },
          ],
          detail: "no such scene",
        },
      ]);
    },
  },
  {
    name: "error protocol: reconnect on a snapshot",
    given: ready,
    message: { type: "error", code: "protocol", detail: "bad item" },
    expectAfter: async (h) => {
      await h.clock.advance(0);
      h.socket().open();
      expect(h.socket().hello().have).toBeNull();
    },
  },
  {
    name: "error unsupported_protocol: closed, with pending items reported",
    given: inflight,
    message: { type: "error", code: "unsupported_protocol", detail: "protocol 1 only" },
    expectAfter: (h) => {
      expect(h.client.getState().conn).toBe("closed");
      expect(h.reports[0]).toMatchObject({ reason: "closed", items: [{ kind: "edits", sent: true }] });
    },
  },
  {
    name: "presence from a peer: listed, and its departure removes it",
    given: ready,
    message: { type: "presence", clientId: "peer", name: "Pat", selection: "w", version: "draft" },
    expectAfter: (h) => {
      expect(h.client.getState().peers).toEqual([{ clientId: "peer", name: "Pat", selection: "w", version: "draft" }]);
      h.socket().deliver({ type: "presence", clientId: "peer", left: true });
      expect(h.client.getState().peers).toEqual([]);
    },
  },
  {
    name: "a frame that is not protocol 2: the session restarts on a snapshot",
    given: ready,
    message: "{not json",
    expectAfter: (h) => {
      expect(h.client.getState().conn).toBe("offline");
    },
  },
  {
    name: "an entry before the welcome: the session restarts",
    given: connected,
    message: { type: "entry", ...entryOf(1, {}) },
    expectAfter: (h) => {
      expect(h.client.getState().conn).toBe("offline");
    },
  },
];

describe("SceneSyncClient transitions by message", () => {
  for (const row of rows) {
    test(row.name, async () => {
      const h = harness();
      await row.given(h);
      h.socket().deliver(row.message);
      await row.expectAfter(h);
      assertSyncInvariants(h.client.inspect());
    });
  }
});

describe("SceneSyncClient transitions by event", () => {
  test("open() answering null: unavailable, asked again every 30 s, edits stay queued", async () => {
    let answer: string | null = null;
    let calls = 0;
    const h = harness(async () => {
      calls++;
      return answer;
    });
    h.client.start();
    await flush();
    expect(h.client.getState()).toMatchObject({ conn: "unavailable", retrying: true });
    await h.clock.advance(UNAVAILABLE_RETRY_MS - 1);
    expect(calls).toBe(1);
    answer = "ws://engine";
    await h.clock.advance(1);
    expect(calls).toBe(2);
    expect(h.sockets).toHaveLength(1);
  });

  test("socket closed: offline, then reconnects with backoff 0, 1 s, 2 s", async () => {
    const h = harness();
    await ready(h);
    h.socket().serverClose(1006);
    expect(h.client.getState().conn).toBe("offline");
    await h.clock.advance(0);
    expect(h.sockets).toHaveLength(2);
    h.socket().serverClose(1006);
    await h.clock.advance(BACKOFF_BASE_MS - 1);
    expect(h.sockets).toHaveLength(2);
    await h.clock.advance(1);
    expect(h.sockets).toHaveLength(3);
    h.socket().serverClose(1006);
    await h.clock.advance(2 * BACKOFF_BASE_MS);
    expect(h.sockets).toHaveLength(4);
  });

  test("close 4404: gone", async () => {
    const h = harness();
    await inflight(h);
    h.socket().serverClose(CLOSE_CODES.notFound, "scene deleted");
    expect(h.client.getState().conn).toBe("gone");
    expect(h.reports[0]).toMatchObject({ reason: "gone" });
  });

  test("edits while one is in flight compose into one queued item; a different version starts another", async () => {
    const h = harness();
    await inflight(h);
    h.client.edit("draft", setY(2));
    h.client.edit("draft", setY(3));
    h.client.edit("published", setY(4));
    const queue = h.client.inspect().queue;
    expect(queue.map((item) => item.body.kind === "edit" && item.body.version)).toEqual(["draft", "published"]);
    expect(h.client.getState().local?.draft.widgets.w).toMatchObject({ x: 1, y: 3 });
    assertSyncInvariants(h.client.inspect());
  });

  test("a queued edit is split where composing would pass the size limit", async () => {
    const h = harness();
    await inflight(h);
    const big = "x".repeat(MAX_OPS_BYTES / 2);
    h.client.edit("draft", (doc) => {
      doc.layout.a = big;
      return doc;
    });
    h.client.edit("draft", (doc) => {
      doc.layout.b = big;
      return doc;
    });
    expect(h.client.inspect().queue).toHaveLength(2);
    assertSyncInvariants(h.client.inspect());
  });

  test("an edit that is not a valid scene change is refused and changes nothing", async () => {
    const h = harness();
    await ready(h);
    const result = h.client.edit("draft", (doc) => {
      doc.widgets.w!.opacity = 4;
      return doc;
    });
    expect(result).toEqual({ ok: false, detail: "invalid opacity" });
    expect(h.client.hasPending()).toBe(false);
  });

  test("edits and commands are refused before the scene loads", async () => {
    const h = harness();
    await connected(h);
    expect(h.client.edit("draft", setX(1)).ok).toBe(false);
    expect(h.client.publish()).toBe(false);
  });

  test("items go out at least 100 ms apart", async () => {
    const h = harness();
    await inflight(h);
    h.client.publish();
    await h.clock.advance(10);
    h.socket().deliver({ type: "ack", seq: 1, v: 0 });
    expect(h.socket().items()).toHaveLength(1);
    await h.clock.advance(SEND_SPACING_MS - 11);
    expect(h.socket().items()).toHaveLength(1);
    await h.clock.advance(1);
    expect(h.socket().items()[1]).toMatchObject({ seq: 2, body: { kind: "publish" } });
    expect(h.client.getState().pendingCommand).toBe("publish");
  });

  test("stop() with nothing pending closes at once, without a report", async () => {
    const h = harness();
    await ready(h);
    h.client.stop();
    expect(h.client.getState().conn).toBe("closed");
    expect(h.reports).toEqual([]);
    expect(h.sockets[0]!.closed?.code).toBe(1000);
  });

  test("stop() hides the client, drains, then closes", async () => {
    const h = harness();
    await inflight(h);
    h.client.stop();
    expect(h.socket().sent[h.socket().sent.length - 1]).toEqual({ type: "presence", away: true });
    expect(h.client.getState()).toMatchObject({ conn: "ready", stopping: true });
    h.socket().deliver({ type: "ack", seq: 1, v: 0 });
    expect(h.client.getState().conn).toBe("closed");
    expect(h.reports).toEqual([]);
  });

  test("stop() reports what is left at the deadline: sent, never sent, and commands that may have run", async () => {
    const h = harness();
    await ready(h);
    h.client.publish();
    h.client.edit("draft", setX(1));
    h.client.discard();
    h.client.stop();
    await h.clock.advance(DRAIN_DEADLINE_MS);
    expect(h.client.getState().conn).toBe("closed");
    expect(h.reports).toEqual([
      {
        reason: "closed",
        items: [
          { kind: "publish", maybeRan: true },
          { kind: "edits", version: "draft", sent: false },
          { kind: "discard", maybeRan: false },
        ],
        detail: expect.any(String),
      },
    ]);
  });

  test("resume() cancels stop(): the deadline does not fire", async () => {
    const h = harness();
    await inflight(h);
    h.client.stop();
    expect(h.client.resume()).toBe(true);
    await h.clock.advance(DRAIN_DEADLINE_MS * 2);
    expect(h.client.getState()).toMatchObject({ conn: "ready", stopping: false });
    expect(h.reports).toEqual([]);
  });

  test("abandon() closes at once and reports nothing", async () => {
    const h = harness();
    await inflightAndQueued(h);
    h.client.abandon();
    expect(h.client.getState().conn).toBe("closed");
    expect(h.reports).toEqual([]);
    assertSyncInvariants(h.client.inspect());
  });

  test("getState keeps its identity until something changes, and subscribers hear changes", async () => {
    const h = harness();
    await ready(h);
    let heard = 0;
    const unsubscribe = h.client.subscribe(() => {
      heard++;
    });
    const before = h.client.getState();
    expect(h.client.getState()).toBe(before);
    h.client.edit("draft", setX(1));
    expect(h.client.getState()).not.toBe(before);
    expect(heard).toBeGreaterThan(0);
    unsubscribe();
    const count = heard;
    h.client.edit("draft", setX(2));
    expect(heard).toBe(count);
  });

  test("presence is sent when ready and again after a reconnect", async () => {
    const h = harness();
    await ready(h);
    h.client.setPresence("w", "draft");
    expect(h.socket().sent[h.socket().sent.length - 1]).toEqual({ type: "presence", selection: "w", version: "draft" });
    h.socket().serverClose(1006);
    await h.clock.advance(0);
    h.socket().open();
    h.socket().deliver(catchupWelcome([]));
    expect(h.socket().sent).toContainEqual({ type: "presence", selection: "w", version: "draft" });
  });
});
