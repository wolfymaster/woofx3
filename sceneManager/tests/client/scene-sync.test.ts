import { describe, expect, it } from "bun:test";
import type { SceneConfig } from "../../contract/scene-config";
import type { SceneSnapshot } from "../../public/scene-manager/scene-document";
import { SceneSync, type SceneSyncDeps } from "../../public/scene-manager/scene-sync";

const emptyDoc = { layout: {}, widgets: {}, behaviors: {} };
const snapshot = (seq: number): SceneSnapshot => ({ sceneId: "s1", name: "Main", seq, doc: emptyDoc, meta: {} });
const sceneBody = (extra: Record<string, unknown> = {}) => ({
  scene: { id: "s1", name: "Main", layout: {}, widgets: [] },
  ...extra,
});

class Timers {
  time = 0;
  private id = 0;
  readonly pending = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number) => {
    this.id += 1;
    this.pending.set(this.id, { at: this.time + ms, fn });
    return this.id;
  };
  clearTimeout = (handle: unknown) => {
    this.pending.delete(handle as number);
  };
  now = () => this.time;
}

function harness(overrides: Partial<SceneSyncDeps> = {}) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const applied: Array<{ config: SceneConfig; fromDraft: boolean }> = [];
  let reloads = 0;
  const responses: Array<() => Promise<Response>> = [];
  const timers = new Timers();
  const deps: SceneSyncDeps = {
    sceneId: "s1",
    sceneBase: "/scene/s1",
    view: "published",
    initialDocument: snapshot(3),
    fetch: (url, init) => {
      requests.push({ url, init });
      const next = responses.shift();
      return next ? next() : Promise.resolve(Response.json(sceneBody({ document: snapshot(3) })));
    },
    timers,
    draftPlacements: () => null,
    onDraftAnswered: () => {},
    apply: (config, fromDraft) => applied.push({ config, fromDraft }),
    earliestMediaExpiry: () => null,
    reload: () => {
      reloads += 1;
    },
    warn: () => {},
    ...overrides,
  };
  return { sync: new SceneSync(deps), requests, applied, responses, timers, reloads: () => reloads };
}

describe("SceneSync ops", () => {
  it("applies the next sequence number's ops without asking the server", () => {
    const h = harness();
    h.sync.applyOps({ seq: 4, ops: [], meta: {} } as never);
    expect(h.sync.document()?.seq).toBe(4);
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0]!.fromDraft).toBe(false);
    expect(h.requests).toHaveLength(0);
  });

  it("ignores ops it has and ops for the other version", () => {
    const h = harness();
    h.sync.applyOps({ seq: 3, ops: [], meta: {} } as never);
    h.sync.applyOps({ seq: 4, version: "draft", ops: [], meta: {} } as never);
    expect(h.applied).toHaveLength(0);
    expect(h.requests).toHaveLength(0);
  });

  it("resyncs on a gap, taking the fetched document as its own", async () => {
    const h = harness();
    h.responses.push(async () => Response.json(sceneBody({ document: snapshot(9) })));
    h.sync.applyOps({ seq: 6, ops: [], meta: {} } as never);
    await Bun.sleep(0);
    expect(h.requests[0]!.url).toBe("/scene/s1/config");
    expect(h.sync.document()?.seq).toBe(9);
    expect(h.applied).toHaveLength(1);
  });

  it("asks the server for the draft instead while the editor previews one", async () => {
    const h = harness({ draftPlacements: () => [{ id: "a" }] });
    h.sync.applyOps({ seq: 4, ops: [], meta: {} } as never);
    await Bun.sleep(0);
    expect(h.requests[0]!.url).toBe("/scene/s1/draft-config");
    expect(h.applied[0]!.fromDraft).toBe(true);
  });

  it("resyncs when the stream opens at a sequence it does not have", async () => {
    const h = harness();
    h.sync.onStreamOpened(3, 0);
    expect(h.requests).toHaveLength(0);
    h.sync.onStreamOpened(5, 0);
    await Bun.sleep(0);
    expect(h.requests).toHaveLength(1);
  });

  it("reads the draft's sequence on the editor's preview", async () => {
    const h = harness({ view: "draft" });
    h.sync.onStreamOpened(99, 3);
    expect(h.requests).toHaveLength(0);
  });
});

describe("SceneSync updates", () => {
  it("collapses updates requested while one is in flight into one more fetch", async () => {
    const h = harness();
    let release: (() => void) | null = null;
    h.responses.push(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(Response.json(sceneBody()));
        })
    );
    const first = h.sync.update();
    void h.sync.update();
    void h.sync.update();
    release!();
    await first;
    expect(h.requests).toHaveLength(2);
    expect(h.applied).toHaveLength(2);
  });

  it("reloads when the saved scene cannot be fetched", async () => {
    const h = harness();
    h.responses.push(async () => new Response("nope", { status: 500 }));
    await h.sync.update();
    expect(h.reloads()).toBe(1);
    expect(h.applied).toHaveLength(0);
  });

  it("keeps what is on screen when the server refuses a draft, and reloads on 401", async () => {
    const h = harness({ draftPlacements: () => [{ id: "a" }] });
    h.responses.push(async () => new Response("bad", { status: 400 }));
    await h.sync.update();
    expect(h.reloads()).toBe(0);
    h.responses.push(async () => new Response("expired", { status: 401 }));
    await h.sync.update();
    expect(h.reloads()).toBe(1);
  });

  it("hands the draft answer back, so its signed media can be used", async () => {
    const answers: unknown[] = [];
    const h = harness({ draftPlacements: () => [{ id: "a" }], onDraftAnswered: (body) => answers.push(body) });
    h.responses.push(async () => Response.json(sceneBody({ mediaUrls: { a: {} } })));
    await h.sync.update();
    expect(answers).toHaveLength(1);
    expect(h.sync.document()?.seq).toBe(3);
  });

  it("refreshes before the soonest media expiry, and sooner after a failed fetch", async () => {
    const expiry = 3600;
    const h = harness({ draftPlacements: () => [{ id: "a" }], earliestMediaExpiry: () => expiry });
    h.sync.scheduleMediaRefresh();
    const first = [...h.timers.pending.values()][0]!.at;
    expect(first).toBeLessThan(expiry * 1000);
    h.responses.push(async () => new Response("bad", { status: 400 }));
    await h.sync.update();
    expect(h.timers.pending.size).toBe(1);
    expect([...h.timers.pending.values()][0]!.at).toBeLessThanOrEqual(first);
  });
});

describe("SceneSync and a fetch overtaken by the stream", () => {
  it("never rolls the document back to a snapshot older than the ops it applied", async () => {
    const h = harness();
    let release: (() => void) | null = null;
    h.responses.push(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(Response.json(sceneBody({ document: snapshot(3) })));
        })
    );
    h.responses.push(async () => Response.json(sceneBody({ document: snapshot(4) })));
    const updating = h.sync.update();
    h.sync.applyOps({ seq: 4, ops: [], meta: {} } as never);
    release!();
    await updating;
    expect(h.sync.document()?.seq).toBe(4);
    expect(h.requests).toHaveLength(2);
  });
});
