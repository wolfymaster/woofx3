import { describe, expect, test } from "bun:test";
import {
  diffDocuments,
  type EntrySource,
  MAX_DOCUMENT_BYTES,
  MAX_ITEM_BYTES,
  MAX_OPS_BYTES,
  type Ops,
  type SceneDocument,
  sameValue,
} from "./document";
import type { ItemBody } from "./protocol";
import {
  CLIENT_RETENTION_COUNT,
  CLIENT_RETENTION_MS,
  commit,
  createSequencerState,
  decideDuplicate,
  decideWelcome,
  decodeEditorState,
  type EditorState,
  EMPTY_EDITOR_STATE,
  editorStateOf,
  encodeEditorState,
  LOG_MAX_BYTES,
  LOG_MAX_ENTRIES,
  type Plan,
  prepare,
  recordRefusal,
  type SequencerState,
  watermarkOf,
} from "./sequencer";
import { bothDocs, placement, sceneDoc } from "./test-support";

const A: EntrySource = { clientId: "client-a", seq: 1 };

function newState(doc: SceneDocument = sceneDoc({ w: placement({ name: "ab" }) }), editorState?: EditorState) {
  return createSequencerState({
    docs: bothDocs(doc),
    hasDraft: false,
    editorState: editorState ?? { ...EMPTY_EDITOR_STATE, clients: {} },
    epoch: "e1",
  });
}

function edit(version: "draft" | "published", ops: Ops): ItemBody {
  return { kind: "edit", version, ops };
}

function planOf(result: ReturnType<typeof prepare>): Plan {
  if (result.refused) {
    throw new Error(`refused: ${result.code} ${result.detail}`);
  }
  return result;
}

/** Prepare and commit as the shell does, returning the reply kind. */
function submit(state: SequencerState, src: EntrySource, base: number, body: ItemBody, now = 0) {
  const duplicate = decideDuplicate(state, src);
  if (duplicate !== null) {
    return duplicate;
  }
  const result = prepare(state, base, body);
  if (result.refused) {
    return recordRefusal(state, src, result, now);
  }
  const entry = commit(state, result, {}, src, now);
  return entry === null ? { type: "ack" as const, seq: src.seq, v: state.v } : { type: "entry" as const, ...entry };
}

describe("prepare: transform from base", () => {
  test("an item made against an older base is transformed through the entries after it", () => {
    const state = newState();
    submit(state, { clientId: "b", seq: 1 }, 0, edit("draft", [{ p: ["widgets", "w", "name", 1], si: "B" }]));
    const reply = submit(state, A, 0, edit("draft", [{ p: ["widgets", "w", "name", 1], si: "A" }]));

    expect(reply.type).toBe("entry");
    expect(state.docs.draft.widgets.w!.name).toBe("aABb");
    expect(state.v).toBe(2);
  });

  test("on a replace tie the item committed later wins", () => {
    const state = newState();
    submit(state, { clientId: "b", seq: 1 }, 0, edit("draft", [{ p: ["widgets", "w", "x"], od: 0, oi: 1 }]));
    submit(state, A, 0, edit("draft", [{ p: ["widgets", "w", "x"], od: 0, oi: 2 }]));
    expect(state.docs.draft.widgets.w!.x).toBe(2);
  });

  test("an item that transforms to nothing is acknowledged without an entry and recorded as applied", () => {
    const state = newState();
    submit(
      state,
      { clientId: "b", seq: 1 },
      0,
      edit("draft", [{ p: ["widgets", "w"], od: placement({ name: "ab" }) }])
    );
    const reply = submit(state, A, 0, edit("draft", [{ p: ["widgets", "w", "x"], od: 0, oi: 5 }]));

    expect(reply).toEqual({ type: "ack", seq: 1, v: 1 });
    expect(state.log).toHaveLength(1);
    expect(watermarkOf(state, A.clientId)).toEqual({ seq: 1, outcome: "applied" });
  });

  test("a base older than the log is stale_base; a base past the head is too", () => {
    const state = newState();
    for (let i = 1; i <= LOG_MAX_ENTRIES + 2; i++) {
      submit(state, { clientId: "b", seq: i }, state.v, edit("draft", [{ p: ["layout", "n"], oi: i }]));
    }
    const old = prepare(state, 1, edit("draft", [{ p: ["layout", "m"], oi: 1 }]));
    const ahead = prepare(state, state.v + 1, edit("draft", [{ p: ["layout", "m"], oi: 1 }]));
    expect(old.refused && old.code).toBe("stale_base");
    expect(ahead.refused && ahead.code).toBe("stale_base");
  });

  test("ops that do not apply or break the document's shape are invalid", () => {
    const state = newState();
    const missing = prepare(state, 0, edit("draft", [{ p: ["widgets", "nope", "x"], od: 0, oi: 1 }]));
    const shape = prepare(state, 0, edit("draft", [{ p: ["widgets", "w", "opacity"], od: 1, oi: 7 }]));
    expect(missing.refused && missing.code).toBe("invalid");
    expect(shape.refused && shape.code).toBe("invalid");
  });
});

describe("prepare is pure", () => {
  test("a refusal leaves the state deep-equal", () => {
    const state = newState();
    submit(state, { clientId: "b", seq: 1 }, 0, edit("draft", [{ p: ["widgets", "w", "x"], od: 0, oi: 1 }]));
    const before = structuredClone(state);

    for (const body of [
      edit("draft", [{ p: ["widgets", "nope", "x"], od: 0, oi: 1 }]),
      edit("published", [{ p: ["widgets", "w", "z"], oi: "" }]),
      edit("draft", []),
    ]) {
      expect(prepare(state, 1, body).refused).toBe(true);
    }
    expect(prepare(state, 5, edit("draft", [{ p: ["layout", "a"], oi: 1 }])).refused).toBe(true);
    expect(state).toEqual(before);
  });

  test("a plan that is not committed changes nothing", () => {
    const state = newState();
    const before = structuredClone(state);
    for (const body of [
      edit("published", [{ p: ["widgets", "w", "x"], od: 0, oi: 3 }]),
      { kind: "publish" } as const,
      { kind: "discard" } as const,
    ]) {
      expect(prepare(state, 0, body).refused).toBe(false);
    }
    expect(state).toEqual(before);
  });

  test("commit refuses a plan prepared against another head, before changing anything", () => {
    const state = newState();
    const stale = planOf(prepare(state, 0, edit("draft", [{ p: ["layout", "a"], oi: 1 }])));
    submit(state, A, 0, edit("draft", [{ p: ["layout", "b"], oi: 1 }]));
    const before = structuredClone(state);
    expect(() => commit(state, stale, {}, { clientId: "c", seq: 1 }, 0)).toThrow();
    expect(state).toEqual(before);
  });
});

describe("duplicates", () => {
  test("a resend of an applied item is acknowledged and not applied twice", () => {
    const state = newState();
    const body = edit("draft", [{ p: ["widgets", "w", "name", 2], si: "!" }]);
    submit(state, A, 0, body);
    const reply = submit(state, A, 0, body);
    expect(reply).toEqual({ type: "ack", seq: 1, v: 1 });
    expect(state.docs.draft.widgets.w!.name).toBe("ab!");
  });

  test("a resend of a rejected item gets the same refusal", () => {
    const state = newState();
    const body = edit("draft", [{ p: ["widgets", "nope", "x"], od: 0, oi: 1 }]);
    const first = submit(state, A, 0, body);
    const second = submit(state, A, 0, body);
    expect(first).toMatchObject({ type: "nack", code: "invalid", retryable: false });
    expect(second).toMatchObject({ type: "nack", seq: 1, code: "invalid", retryable: false });
    expect(watermarkOf(state, A.clientId)).toEqual({ seq: 1, outcome: "rejected", code: "invalid" });
  });

  test("a retryable refusal is not recorded, so the resend is decided again", () => {
    const state = newState();
    const nack = recordRefusal(state, A, { refused: true, code: "unavailable", detail: "db down" }, 0);
    expect(nack.retryable).toBe(true);
    expect(decideDuplicate(state, A)).toBeNull();
  });

  test("seqs may skip numbers; anything above the watermark is new", () => {
    const state = newState();
    submit(state, A, 0, edit("draft", [{ p: ["layout", "a"], oi: 1 }]));
    expect(decideDuplicate(state, { clientId: A.clientId, seq: 5 })).toBeNull();
  });
});

describe("live edits, publish and discard", () => {
  test("a live edit is copied into the draft in the same entry, keeping the draft's own edits", () => {
    const state = newState(sceneDoc({ w: placement(), v: placement() }));
    submit(state, A, 0, edit("draft", [{ p: ["widgets", "w", "y"], od: 0, oi: 7 }]));
    const reply = submit(
      state,
      { clientId: A.clientId, seq: 2 },
      1,
      edit("published", [{ p: ["widgets", "w", "x"], od: 0, oi: 3 }])
    );

    expect(reply.type).toBe("entry");
    if (reply.type !== "entry") {
      return;
    }
    expect(reply.changes.published).toEqual([{ p: ["widgets", "w", "x"], od: 0, oi: 3 }]);
    expect(reply.changes.draft).toEqual([{ p: ["widgets", "w", "x"], od: 0, oi: 3 }]);
    expect(state.docs.draft.widgets.w).toMatchObject({ x: 3, y: 7 });
    expect(state.docs.published.widgets.w).toMatchObject({ x: 3, y: 0 });
    expect(reply.hasDraft).toBe(true);
  });

  test("a live removal removes the placement from the draft; a live addition adds it", () => {
    const state = newState(sceneDoc({ w: placement() }));
    submit(state, A, 0, edit("published", [{ p: ["widgets", "w"], od: placement() }]));
    submit(
      state,
      { clientId: A.clientId, seq: 2 },
      1,
      edit("published", [{ p: ["widgets", "n"], oi: placement({ x: 4 }) }])
    );
    expect(Object.keys(state.docs.draft.widgets)).toEqual(["n"]);
    expect(state.hasDraft).toBe(false);
  });

  test("publish makes the published scene the draft in one entry and clears hasDraft", () => {
    const state = newState();
    submit(state, A, 0, edit("draft", [{ p: ["widgets", "w", "x"], od: 0, oi: 9 }]));
    const draft = structuredClone(state.docs.draft);
    const before = structuredClone(state.docs.published);
    const reply = submit(state, { clientId: A.clientId, seq: 2 }, 1, { kind: "publish" });

    expect(reply).toMatchObject({ type: "entry", kind: "publish", hasDraft: false });
    if (reply.type !== "entry") {
      return;
    }
    expect(reply.changes).toEqual({ published: diffDocuments(before, draft) });
    expect(sameValue(state.docs.published, draft)).toBe(true);
  });

  test("publish with nothing to publish still commits an entry", () => {
    const state = newState();
    const reply = submit(state, A, 0, { kind: "publish" });
    expect(reply).toMatchObject({ type: "entry", v: 1, kind: "publish", changes: {}, hasDraft: false });
  });

  test("discard resets the draft to the published scene in one entry", () => {
    const state = newState();
    submit(state, A, 0, edit("draft", [{ p: ["widgets", "w", "x"], od: 0, oi: 9 }]));
    const reply = submit(state, { clientId: A.clientId, seq: 2 }, 1, { kind: "discard" });
    expect(reply).toMatchObject({
      type: "entry",
      kind: "discard",
      hasDraft: false,
      changes: { draft: [{ p: ["widgets", "w", "x"], od: 9, oi: 0 }] },
    });
    expect(sameValue(state.docs.draft, state.docs.published)).toBe(true);
  });

  test("an external change is copied into the draft only when asked", () => {
    const state = newState();
    submit(state, A, 0, edit("draft", [{ p: ["widgets", "w", "y"], od: 0, oi: 1 }]));
    const plan = planOf(
      prepare(state, 1, {
        kind: "external",
        version: "published",
        ops: [{ p: ["widgets", "w", "x"], od: 0, oi: 4 }],
        mirrorIntoDraft: false,
      })
    );
    const entry = commit(state, plan, {}, null, 0);
    expect(entry).toMatchObject({
      kind: "external",
      src: null,
      changes: { published: [{ p: ["widgets", "w", "x"], od: 0, oi: 4 }] },
    });
    expect(state.docs.draft.widgets.w!.x).toBe(0);
  });
});

describe("the log", () => {
  test(`keeps at most ${LOG_MAX_ENTRIES} entries`, () => {
    const state = newState();
    for (let i = 1; i <= LOG_MAX_ENTRIES + 5; i++) {
      submit(state, { clientId: "b", seq: i }, state.v, edit("draft", [{ p: ["layout", "n"], oi: i }]));
    }
    expect(state.log).toHaveLength(LOG_MAX_ENTRIES);
    expect(state.log[0]!.v).toBe(6);
    expect(state.log[state.log.length - 1]!.v).toBe(state.v);
  });

  test(`keeps at most ${LOG_MAX_BYTES} bytes of ops`, () => {
    const state = newState();
    const big = "x".repeat(50 * 1024);
    for (let i = 1; i <= 12; i++) {
      submit(state, { clientId: "b", seq: i }, state.v, edit("draft", [{ p: ["layout", `k${i}`], oi: big }]));
    }
    expect(state.logBytes).toBeLessThanOrEqual(LOG_MAX_BYTES);
    expect(state.log.length).toBeLessThan(12);
    const counted = state.log.reduce((sum, entry) => sum + JSON.stringify(entry.changes.draft).length, 0);
    expect(state.logBytes).toBe(counted);
  });
});

describe("editor state persistence", () => {
  test("watermarks and the head survive a round trip and a restart", () => {
    const state = newState();
    submit(state, A, 0, edit("draft", [{ p: ["layout", "a"], oi: 1 }]), 1000);
    submit(state, { clientId: "b", seq: 3 }, 1, edit("draft", [{ p: ["widgets", "nope", "x"], od: 0, oi: 1 }]), 2000);

    const decoded = decodeEditorState(encodeEditorState(editorStateOf(state, 3000)));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    const restarted = createSequencerState({
      docs: state.docs,
      hasDraft: state.hasDraft,
      editorState: decoded.state,
      epoch: "e2",
    });

    expect(restarted.v).toBe(1);
    expect(restarted.headId).toBe("e1.1");
    expect(restarted.log).toEqual([]);
    expect(decideDuplicate(restarted, A)).toEqual({ type: "ack", seq: 1, v: 1 });
    expect(decideDuplicate(restarted, { clientId: "b", seq: 3 })).toMatchObject({ type: "nack", code: "invalid" });
    const next = submit(restarted, { clientId: A.clientId, seq: 2 }, 1, edit("draft", [{ p: ["layout", "b"], oi: 1 }]));
    expect(next).toMatchObject({ type: "entry", v: 2, id: "e2.2" });
  });

  test("an empty column starts from no history; a malformed one is an error", () => {
    expect(decodeEditorState(null)).toEqual({ ok: true, state: { v: 0, headId: "", clients: {} } });
    expect(decodeEditorState("")).toEqual({ ok: true, state: { v: 0, headId: "", clients: {} } });
    expect(decodeEditorState("{").ok).toBe(false);
    expect(decodeEditorState(JSON.stringify({ v: -1, headId: "", clients: {} })).ok).toBe(false);
    expect(decodeEditorState(JSON.stringify({ v: 1, headId: "", clients: { a: { seq: 0 } } })).ok).toBe(false);
  });

  test(`forgets watermarks older than 30 days and keeps the ${CLIENT_RETENTION_COUNT} most recent`, () => {
    const now = CLIENT_RETENTION_MS * 2;
    const clients: EditorState["clients"] = { old: { seq: 1, outcome: "applied", at: now - CLIENT_RETENTION_MS - 1 } };
    for (let i = 0; i < CLIENT_RETENTION_COUNT + 10; i++) {
      clients[`c${i}`] = { seq: 1, outcome: "applied", at: now - i };
    }
    const state = newState(undefined, { v: 0, headId: "", clients });
    const kept = editorStateOf(state, now).clients;

    expect(Object.keys(kept)).toHaveLength(CLIENT_RETENTION_COUNT);
    expect(kept.old).toBeUndefined();
    expect(kept.c0).toBeDefined();
    expect(kept[`c${CLIENT_RETENTION_COUNT + 9}`]).toBeUndefined();
  });
});

describe("decideWelcome", () => {
  function stateWithEntries(count: number): SequencerState {
    const state = newState();
    for (let i = 1; i <= count; i++) {
      submit(state, { clientId: "b", seq: i }, state.v, edit("draft", [{ p: ["layout", "n"], oi: i }]));
    }
    return state;
  }

  test("no history: snapshot", () => {
    expect(decideWelcome(stateWithEntries(2), null)).toEqual({ kind: "snapshot", diverged: false });
  });

  test("at the head: empty catch-up", () => {
    expect(decideWelcome(stateWithEntries(2), { v: 2, id: "e1.2" })).toEqual({ kind: "catchup", entries: [] });
  });

  test("an entry in the log: the entries after it", () => {
    const decision = decideWelcome(stateWithEntries(4), { v: 2, id: "e1.2" });
    expect(decision.kind).toBe("catchup");
    expect(decision.kind === "catchup" && decision.entries.map((entry) => entry.v)).toEqual([3, 4]);
  });

  test("older than the log: snapshot, not diverged", () => {
    const state = stateWithEntries(LOG_MAX_ENTRIES + 3);
    expect(decideWelcome(state, { v: 1, id: "e1.1" })).toEqual({ kind: "snapshot", diverged: false });
  });

  test("past the head, or another entry at the same number: diverged", () => {
    const state = stateWithEntries(3);
    expect(decideWelcome(state, { v: 4, id: "e1.4" })).toEqual({ kind: "snapshot", diverged: true });
    expect(decideWelcome(state, { v: 3, id: "e0.3" })).toEqual({ kind: "snapshot", diverged: true });
    expect(decideWelcome(state, { v: 2, id: "e0.2" })).toEqual({ kind: "snapshot", diverged: true });
  });

  test("after a crash the new epoch's entries do not match what the client applied", () => {
    const crashed = stateWithEntries(5);
    const persisted: EditorState = { v: 3, headId: "e1.3", clients: {} };
    const reloaded = createSequencerState({ docs: crashed.docs, hasDraft: false, editorState: persisted, epoch: "e9" });
    expect(decideWelcome(reloaded, { v: 5, id: "e1.5" })).toEqual({ kind: "snapshot", diverged: true });
    expect(decideWelcome(reloaded, { v: 3, id: "e1.3" })).toEqual({ kind: "catchup", entries: [] });
    submit(reloaded, A, 3, edit("draft", [{ p: ["layout", "x"], oi: 1 }]));
    submit(reloaded, { clientId: A.clientId, seq: 2 }, 4, edit("draft", [{ p: ["layout", "y"], oi: 1 }]));
    expect(decideWelcome(reloaded, { v: 5, id: "e1.5" })).toEqual({ kind: "snapshot", diverged: true });
  });
});

describe("a live edit copied into the draft, per touched field", () => {
  test("a live layout edit keeps the draft's own edits to other layout keys", () => {
    const state = newState();
    submit(state, A, 0, edit("draft", [{ p: ["layout", "theme"], oi: "dark" }]));
    submit(
      state,
      { clientId: A.clientId, seq: 2 },
      1,
      edit("published", [{ p: ["layout", "width"], od: 1920, oi: 1280 }])
    );
    expect(state.docs.draft.layout).toEqual({ width: 1280, height: 1080, theme: "dark" });
  });

  test("a live edit to a placement the draft removed does not bring it back", () => {
    const state = newState(sceneDoc({ w: placement(), v: placement() }));
    submit(state, A, 0, edit("draft", [{ p: ["widgets", "w"], od: placement() }]));
    const reply = submit(
      state,
      { clientId: A.clientId, seq: 2 },
      1,
      edit("published", [{ p: ["widgets", "w", "x"], od: 0, oi: 3 }])
    );
    expect(reply).toMatchObject({
      type: "entry",
      changes: { published: [{ p: ["widgets", "w", "x"], od: 0, oi: 3 }] },
    });
    expect(Object.keys(state.docs.draft.widgets)).toEqual(["v"]);
  });

  test("a live replacement of a placement the draft removed does not bring it back; a live addition does add", () => {
    const state = newState(sceneDoc({ w: placement() }));
    submit(state, A, 0, edit("draft", [{ p: ["widgets", "w"], od: placement() }]));
    submit(
      state,
      { clientId: A.clientId, seq: 2 },
      1,
      edit("published", [
        { p: ["widgets", "w"], od: placement(), oi: placement({ x: 9 }) },
        { p: ["widgets", "n"], oi: placement({ x: 4 }) },
      ])
    );
    expect(Object.keys(state.docs.draft.widgets)).toEqual(["n"]);
  });
});

describe("external changes", () => {
  test("are not bound by the size limit on an editor's item, only by the document's", () => {
    const state = newState();
    const big = "x".repeat(MAX_OPS_BYTES * 2);
    const plan = prepare(state, 0, {
      kind: "external",
      version: "published",
      ops: [{ p: ["layout", "note"], oi: big }],
      mirrorIntoDraft: true,
    });
    expect(plan.refused).toBe(false);
    const huge = prepare(state, 0, {
      kind: "external",
      version: "published",
      ops: [{ p: ["layout", "note"], oi: "x".repeat(MAX_DOCUMENT_BYTES) }],
      mirrorIntoDraft: true,
    });
    expect(huge).toMatchObject({ refused: true, code: "invalid", detail: "the scene would be too large" });
  });

  test("with no ops change nothing", () => {
    const state = newState();
    const plan = planOf(prepare(state, 0, { kind: "external", version: "published", ops: [], mirrorIntoDraft: true }));
    expect(commit(state, plan, {}, null, 0)).toBeNull();
    expect(state.v).toBe(0);
  });

  test("with no ops but changed meta commit an entry carrying only the meta", () => {
    const state = newState();
    const plan = planOf(prepare(state, 0, { kind: "external", version: "published", ops: [], mirrorIntoDraft: true }));
    const meta = {
      published: { w: { moduleId: "m", hostsSurface: "", frameUrl: "/frames/w?v=2", linkedResources: {} } },
    };
    const entry = commit(state, plan, meta, null, 0);
    expect(entry).toMatchObject({ v: 1, kind: "external", changes: {}, meta });
    expect(state.v).toBe(1);
  });
});

describe("item size", () => {
  test("an item larger than a client queues, as transforms can make it, is taken up to MAX_ITEM_BYTES", () => {
    const state = newState();
    const grown = prepare(state, 0, edit("draft", [{ p: ["layout", "note"], oi: "x".repeat(MAX_OPS_BYTES * 2) }]));
    expect(grown.refused).toBe(false);
    const tooLarge = prepare(
      state,
      0,
      edit("draft", [{ p: ["layout", "note"], od: "x".repeat(MAX_ITEM_BYTES), oi: 1 }])
    );
    expect(tooLarge).toMatchObject({ refused: true, code: "invalid", detail: "ops too large" });
  });

  test("text spliced past a field's limit is refused", () => {
    const state = newState(sceneDoc({ w: placement({ name: "x".repeat(256) }) }));
    expect(prepare(state, 0, edit("draft", [{ p: ["widgets", "w", "name", 0], si: "y" }]))).toMatchObject({
      refused: true,
      code: "invalid",
      detail: "placement w would not be valid",
    });
  });
});

describe("bounded state", () => {
  test("an entry larger than the log's byte budget is still kept as the newest", () => {
    const doc = sceneDoc();
    const state = createSequencerState({
      docs: { draft: { ...doc, layout: { ...doc.layout, big: "x".repeat(LOG_MAX_BYTES + 1) } }, published: doc },
      hasDraft: true,
      editorState: { ...EMPTY_EDITOR_STATE, clients: {} },
      epoch: "e1",
    });
    submit(state, A, 0, { kind: "publish" });
    expect(state.log.map((entry) => entry.v)).toEqual([1]);
    const behind = prepare(state, 0, edit("draft", [{ p: ["layout", "width"], od: 1920, oi: 1280 }]));
    expect(behind.refused).toBe(false);
  });

  test(`the in-memory watermarks are pruned to the ${CLIENT_RETENTION_COUNT} most recent`, () => {
    const state = newState();
    for (let i = 0; i < CLIENT_RETENTION_COUNT + 20; i++) {
      submit(state, { clientId: `c${i}`, seq: 1 }, state.v, edit("draft", [{ p: ["layout", "n"], oi: i }]), i);
    }
    expect(state.clients.size).toBeLessThanOrEqual(CLIENT_RETENTION_COUNT);
    expect(state.clients.has(`c${CLIENT_RETENTION_COUNT + 19}`)).toBe(true);
    expect(state.clients.has("c0")).toBe(false);
  });

  test("the document size is tracked exactly as edits, live copies, publishes and discards land", () => {
    const state = newState(sceneDoc({ w: placement({ name: "ab" }), v: placement() }));
    const exact = () => ({
      draft: JSON.stringify(state.docs.draft).length,
      published: JSON.stringify(state.docs.published).length,
    });
    let seq = 1;
    const send = (body: ItemBody) => submit(state, { clientId: "a", seq: seq++ }, state.v, body);
    send(edit("draft", [{ p: ["widgets", "w", "name", 1], si: "xyz" }]));
    expect(state.docBytes).toEqual(exact());
    send(edit("draft", [{ p: ["layout", "theme"], oi: "dark" }]));
    send(edit("published", [{ p: ["widgets", "n"], oi: placement({ settings: { a: "b" } }) }]));
    expect(state.docBytes).toEqual(exact());
    send(edit("published", [{ p: ["widgets", "v"], od: placement() }]));
    send(edit("draft", [{ p: ["widgets", "n", "settings", "a"], od: "b" }]));
    expect(state.docBytes).toEqual(exact());
    send({ kind: "publish" });
    expect(state.docBytes).toEqual(exact());
    send(edit("draft", [{ p: ["widgets", "w"], od: state.docs.draft.widgets.w }]));
    send(edit("draft", [{ p: ["widgets", "n"], od: state.docs.draft.widgets.n }]));
    expect(state.docBytes).toEqual(exact());
    send({ kind: "discard" });
    expect(state.docBytes).toEqual(exact());
  });
});
