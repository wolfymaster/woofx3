// Writing a scene back through the real row parsing: the documents are built
// by OverlayHost from a stored row, edited, and written back, so a placement
// the parser cannot read is exercised end to end instead of through a fake
// store that parses rows its own way.

import { describe, expect, it } from "bun:test";
import type { ServerMessage } from "@woofx3/api/scene-editor";
import {
  type EditorConnection,
  SceneDocuments,
  type SceneDocumentsClock,
  type SceneWrite,
} from "../../src/scene/scene-documents";
import { OverlayHost } from "../../src/scene/scene-host";
import { OverlayTokenResolver } from "../../src/scene/token-resolver";

const silent = { debug() {}, info() {}, warn() {}, error() {} } as never;

class TestClock implements SceneDocumentsClock {
  time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  pending(): number {
    return this.timers.size;
  }

  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) {
        break;
      }
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].callback();
      await settle();
    }
    this.time = end;
    await settle();
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

class Socket implements EditorConnection {
  readonly sent: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;

  send(message: ServerMessage): void {
    this.sent.push(message);
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
}

const readable = { id: "a", widgetCanonicalId: "woofx3:widget:text", position: { x: 0, y: 0 }, settings: {} };
// No canonical id: the parser cannot place it, so it is never shown.
const unreadable = { id: "b", name: "orphan", settings: { text: "keep me" } };

function setup(row: Record<string, unknown>) {
  const db = {
    getScene: async () => ({
      status: { code: "OK" as const, message: "" },
      scene: { id: "s1", name: "Main", layoutJson: "{}", behaviorsJson: "{}", editorStateJson: "", ...row },
    }),
    listWidgets: async () => ({ status: { code: "OK" as const, message: "" }, widgets: [] }),
    getSceneEvent: async () => ({}),
  };
  const resolver = new OverlayTokenResolver({ resolveOverlayToken: async () => ({}) } as never, silent);
  const host = new OverlayHost(resolver, db as never, silent);
  const writes: SceneWrite[] = [];
  const clock = new TestClock();
  const documents = new SceneDocuments(host, { broadcast: () => {}, connectedSceneIds: () => [] }, silent, {
    persister: {
      updateScene: async (write: SceneWrite) => {
        writes.push(write);
      },
    },
    clock,
    newEpoch: () => "epoch",
  });
  return { documents, writes, clock };
}

const moveA = (snapshot: { doc: { widgets: Record<string, { x: number }> } }) => [
  { p: ["widgets", "a", "x"], od: snapshot.doc.widgets.a!.x, oi: 50 },
];

describe("writing a scene back", () => {
  it("keeps a placement it could not read when an editor opens the scene", async () => {
    const { documents, writes, clock } = setup({ widgetsJson: JSON.stringify([readable, unreadable]) });

    await documents.openEditor("s1", { clientId: "c1", have: null, name: "" }, new Socket());
    await clock.advance(5_000);

    expect(writes).toHaveLength(1);
    const stored = JSON.parse(writes[0]!.widgetsJson!) as Array<Record<string, unknown>>;
    expect(stored.map((p) => p.id)).toEqual(["a", "b"]);
    expect(stored[1]).toEqual(unreadable);
  });

  it("keeps it through a change the engine makes", async () => {
    const { documents, writes, clock } = setup({ widgetsJson: JSON.stringify([readable, unreadable]) });

    const result = await documents.applyChange("s1", "published", moveA as never);
    await clock.advance(5_000);

    expect(result).toEqual({ ok: true });
    const stored = JSON.parse(writes.at(-1)!.widgetsJson!) as Array<Record<string, unknown>>;
    expect(stored.find((p) => p.id === "a")?.position).toEqual({ x: 50, y: 0 });
    expect(stored.find((p) => p.id === "b")).toEqual(unreadable);
  });

  it("refuses editors and changes, and never writes, when a whole column cannot be read", async () => {
    const { documents, writes, clock } = setup({ widgetsJson: JSON.stringify([readable]), layoutJson: "{not json" });

    const socket = new Socket();
    await documents.openEditor("s1", { clientId: "c1", have: null, name: "" }, socket);
    const result = await documents.applyChange("s1", "published", moveA as never);
    await clock.advance(5_000);

    expect(socket.sent).toEqual([{ type: "error", code: "not_found", detail: expect.stringContaining("layout") }]);
    expect(socket.closed?.code).toBe(4404);
    expect(result.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(clock.pending()).toBe(0);
  });

  it("still serves what it could read to overlays", async () => {
    const { documents } = setup({ widgetsJson: JSON.stringify([readable, unreadable]) });

    const snapshot = await documents.snapshot("s1");

    expect(Object.keys(snapshot!.doc.widgets)).toEqual(["a"]);
  });
});

describe("writing back placements it could not read, across publish and discard", () => {
  const draftOnly = { id: "c", name: "draft orphan", settings: { text: "only in the draft" } };
  const draftRow = {
    widgetsJson: JSON.stringify([readable]),
    hasDraft: true,
    draftWidgetsJson: JSON.stringify([readable, draftOnly]),
    draftLayoutJson: "{}",
    draftBehaviorsJson: "{}",
  };

  async function openAndSubmit(documents: SceneDocuments, kind: "publish" | "discard"): Promise<void> {
    const socket = new Socket();
    await documents.openEditor("s1", { clientId: "c1", have: null, name: "" }, socket);
    const welcome = socket.sent.find((m) => m.type === "welcome") as { v?: number } | undefined;
    await documents.submitItem("s1", "c1", 1, welcome?.v ?? 0, { kind }, () => {});
  }

  it("leaves a draft's unreadable placement out of the published scene when the draft is discarded", async () => {
    const { documents, writes, clock } = setup(draftRow);
    await openAndSubmit(documents, "discard");
    await clock.advance(5_000);
    const last = writes.at(-1)!;
    expect(last.clearDraft).toBe(true);
    expect((JSON.parse(last.widgetsJson!) as Array<{ id: string }>).map((p) => p.id)).toEqual(["a"]);
  });

  it("carries a draft's unreadable placement into the published scene when the draft is published", async () => {
    const { documents, writes, clock } = setup(draftRow);
    await openAndSubmit(documents, "publish");
    await clock.advance(5_000);
    const last = writes.at(-1)!;
    expect(last.clearDraft).toBe(true);
    expect((JSON.parse(last.widgetsJson!) as Array<{ id: string }>).map((p) => p.id).sort()).toEqual(["a", "c"]);
  });
});
