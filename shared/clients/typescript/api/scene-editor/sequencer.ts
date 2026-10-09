// The scene editor's sequencer, as pure state and functions.
//
// One scene's changes are decided in two steps. `prepare` works out what an
// item would do without touching the state: it transforms the item from its
// base to the head, validates it, applies it to copies, and returns a plan or
// a refusal. The caller may then await things the plan needs (placement
// meta), and `commit` installs the plan in one synchronous step made only of
// assignments. So a refusal means nothing changed, and nothing can fail
// between deciding an item and recording it: every item gets exactly one
// terminal reply.
//
// The caller must run prepare and commit for one scene one at a time, with
// nothing else changing the state between them; `commit` asserts the plan
// was prepared against the current head.

import {
  applyOps,
  diffDocuments,
  type Entry,
  type EntryKind,
  type EntrySource,
  entryIdOf,
  invalidOps,
  isPlainObject,
  MAX_DOCUMENT_BYTES,
  type MetaChanges,
  type Ops,
  opsSize,
  type SceneDocument,
  transformOps,
  type Version,
} from "./document";
import {
  type AckMessage,
  type EntryRef,
  type ItemBody,
  type NackCode,
  type NackMessage,
  nackOf,
  type Watermark,
} from "./protocol";

/** Most entries the in-memory log keeps for transforming late items and catching up reconnects. */
export const LOG_MAX_ENTRIES = 1000;
/** Most bytes of ops the in-memory log keeps, measured by `opsSize`. */
export const LOG_MAX_BYTES = 512 * 1024;
/** A client's watermark is forgotten after this long without an item... */
export const CLIENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** ...or when it is not among the most recent this many. */
export const CLIENT_RETENTION_COUNT = 500;

/** The last item decided for one client, and when. */
export interface ClientRecord extends Watermark {
  /** Milliseconds since the epoch. */
  at: number;
}

/** What is persisted with the documents, in the same write (`editor_state_json`). */
export interface EditorState {
  v: number;
  headId: string;
  clients: Record<string, ClientRecord>;
}

/** The editor state of a scene that has never been edited. */
export const EMPTY_EDITOR_STATE: Readonly<EditorState> = Object.freeze({ v: 0, headId: "", clients: {} });

export interface SequencerState {
  /** The head: the number of the last committed entry. */
  v: number;
  headId: string;
  /** Random per load of the scene into memory; prefixes the ids of entries committed in this load. */
  epoch: string;
  /** Replaced on commit, never changed in place: plans and entries share these objects. */
  docs: Record<Version, SceneDocument>;
  hasDraft: boolean;
  /** The most recent entries, oldest first, contiguous and ending at `v` when non-empty. */
  log: Entry[];
  /** `opsSize` of every entry's changes in `log`, summed. */
  logBytes: number;
  clients: Map<string, ClientRecord>;
}

export interface SequencerInit {
  docs: Record<Version, SceneDocument>;
  hasDraft: boolean;
  editorState: EditorState;
  epoch: string;
}

export function createSequencerState(init: SequencerInit): SequencerState {
  assert(init.epoch.length > 0 && !init.epoch.includes("."), "an epoch is non-empty and has no dot");
  assert(Number.isSafeInteger(init.editorState.v) && init.editorState.v >= 0, "v is a non-negative integer");
  return {
    v: init.editorState.v,
    headId: init.editorState.headId,
    epoch: init.epoch,
    docs: { draft: structuredClone(init.docs.draft), published: structuredClone(init.docs.published) },
    hasDraft: init.hasDraft,
    log: [],
    logBytes: 0,
    clients: new Map(Object.entries(init.editorState.clients)),
  };
}

/**
 * A change the engine makes itself (a workflow step, a save made elsewhere),
 * made against the head. `mirrorIntoDraft` copies a change to the published
 * scene into the draft as a live edit does; a save made elsewhere while a
 * draft exists leaves the draft alone.
 */
export interface ExternalBody {
  kind: "external";
  version: Version;
  ops: Ops;
  mirrorIntoDraft: boolean;
}

export interface Plan {
  refused: false;
  kind: EntryKind;
  /** The head the plan was prepared against. */
  head: number;
  /** Empty for an edit that comes to nothing: committed as a no-op, answered with `ack`. */
  changes: Partial<Record<Version, Ops>>;
  docs: Record<Version, SceneDocument>;
  hasDraft: boolean;
  /** `opsSize` of `changes`, counted against the log's byte budget. */
  bytes: number;
}

export interface Refusal {
  refused: true;
  code: NackCode;
  detail: string;
}

function refuse(code: NackCode, detail: string): Refusal {
  return { refused: true, code, detail };
}

/**
 * What `body`, made against entry `base`, would do to the scene now. Pure:
 * `state` is not changed, whatever the outcome.
 *
 * An edit is transformed through every entry after `base` (json0, the item
 * as `"left"`: on a tie it wins, being committed later). A base the log no
 * longer covers is `stale_base`. A live edit (to the published scene) is
 * copied into the draft field by field in the same entry. A publish or
 * discard always produces an entry, even when the two documents are equal,
 * since it also clears `hasDraft` and is the submitter's acknowledgement.
 */
export function prepare(state: SequencerState, base: number, body: ItemBody | ExternalBody): Plan | Refusal {
  if (!Number.isSafeInteger(base) || base < 0 || base > state.v) {
    return refuse("stale_base", `base ${base} is not an entry of this scene (head ${state.v})`);
  }
  switch (body.kind) {
    case "edit":
    case "external": {
      return prepareEdit(state, base, body);
    }
    case "publish": {
      const changes = diffDocuments(state.docs.published, state.docs.draft);
      return planOf(state, "publish", changes.length > 0 ? { published: changes } : {}, {
        docs: { draft: state.docs.draft, published: structuredClone(state.docs.draft) },
        hasDraft: false,
      });
    }
    case "discard": {
      const changes = diffDocuments(state.docs.draft, state.docs.published);
      return planOf(state, "discard", changes.length > 0 ? { draft: changes } : {}, {
        docs: { draft: structuredClone(state.docs.published), published: state.docs.published },
        hasDraft: false,
      });
    }
  }
}

function prepareEdit(
  state: SequencerState,
  base: number,
  body: Extract<ItemBody, { kind: "edit" }> | ExternalBody
): Plan | Refusal {
  const invalid = invalidOps(body.ops);
  if (invalid !== null) {
    return refuse("invalid", invalid);
  }
  const missed = entriesAfter(state, base);
  if (missed === null) {
    return refuse("stale_base", `base ${base} is older than the entries kept`);
  }
  const version = body.version;
  let ops: Ops = body.ops;
  try {
    for (const entry of missed) {
      const against = entry.changes[version];
      if (against !== undefined) {
        ops = transformOps(ops, against, "left");
      }
    }
  } catch (err) {
    return refuse("invalid", `ops do not transform: ${errorText(err)}`);
  }
  const kind: EntryKind = body.kind === "external" ? "external" : "edit";
  if (ops.length === 0) {
    return planOf(state, kind, {}, { docs: state.docs, hasDraft: state.hasDraft });
  }
  let doc: SceneDocument;
  try {
    doc = applyOps(state.docs[version], ops);
  } catch (err) {
    return refuse("invalid", `ops do not apply: ${errorText(err)}`);
  }
  if (JSON.stringify(doc).length > MAX_DOCUMENT_BYTES) {
    return refuse("invalid", "the scene would be too large");
  }
  if (version === "draft") {
    return planOf(
      state,
      kind,
      { draft: ops },
      { docs: { draft: doc, published: state.docs.published }, hasDraft: true }
    );
  }
  const mirror = body.kind === "edit" || body.mirrorIntoDraft;
  const draft = mirror ? mirrorIntoDraft(state.docs.draft, doc, ops) : state.docs.draft;
  const draftOps = diffDocuments(state.docs.draft, draft);
  const changes: Partial<Record<Version, Ops>> =
    draftOps.length > 0 ? { published: ops, draft: draftOps } : { published: ops };
  return planOf(state, kind, changes, { docs: { draft, published: doc }, hasDraft: state.hasDraft });
}

function planOf(
  state: SequencerState,
  kind: EntryKind,
  changes: Partial<Record<Version, Ops>>,
  result: { docs: Record<Version, SceneDocument>; hasDraft: boolean }
): Plan {
  const bytes = (changes.draft ? opsSize(changes.draft) : 0) + (changes.published ? opsSize(changes.published) : 0);
  return { refused: false, kind, head: state.v, changes, docs: result.docs, hasDraft: result.hasDraft, bytes };
}

/**
 * The draft with what `ops` changed on the published scene copied in, field
 * by field: a live edit wins over the draft's own value for each field it
 * touched, and the draft keeps every other edit it has. A placement the live
 * edit removed is removed from the draft; one it touched that the draft does
 * not have is copied whole.
 */
export function mirrorIntoDraft(draft: SceneDocument, published: SceneDocument, ops: Ops): SceneDocument {
  const target: SceneDocument = structuredClone(draft);
  for (const component of ops) {
    const [root, id, field] = component.p;
    if (root === "layout") {
      target.layout = structuredClone(published.layout);
      continue;
    }
    if (root !== "widgets" || typeof id !== "string") {
      continue;
    }
    const live = published.widgets[id];
    if (!live) {
      delete target.widgets[id];
    } else if (typeof field !== "string" || !target.widgets[id]) {
      target.widgets[id] = structuredClone(live);
    } else {
      (target.widgets[id] as unknown as Record<string, unknown>)[field] = structuredClone(
        (live as unknown as Record<string, unknown>)[field]
      );
    }
  }
  return target;
}

/** The entries after `base`, oldest first, or null when the log no longer has them all. */
export function entriesAfter(state: SequencerState, base: number): Entry[] | null {
  if (base === state.v) {
    return [];
  }
  const first = state.log[0];
  if (first === undefined || first.v > base + 1) {
    return null;
  }
  return state.log.slice(base + 1 - first.v);
}

/**
 * Install a plan: the head moves to a new entry, which is returned, or for a
 * plan that changes nothing the head stays and null is returned (answer with
 * `ack`). `src`'s watermark records the item as applied either way.
 *
 * Synchronous and made only of assignments, so it cannot fail part way for
 * a plan `prepare` just made against this head. The assertions run before
 * anything is assigned.
 */
export function commit(
  state: SequencerState,
  plan: Plan,
  meta: Partial<Record<Version, MetaChanges>>,
  src: EntrySource | null,
  now: number
): Entry | null {
  assert(plan.head === state.v, "a plan is committed against the head it was prepared against");
  if (src !== null) {
    assertNewSeq(state, src);
  }
  const changesNothing = plan.changes.draft === undefined && plan.changes.published === undefined;
  if (changesNothing && (plan.kind === "edit" || plan.kind === "external")) {
    if (src !== null) {
      state.clients.set(src.clientId, { seq: src.seq, outcome: "applied", at: now });
    }
    return null;
  }
  const v = state.v + 1;
  const entry: Entry = {
    v,
    id: entryIdOf(state.epoch, v),
    src: src === null ? null : { clientId: src.clientId, seq: src.seq },
    kind: plan.kind,
    changes: plan.changes,
    meta,
    hasDraft: plan.hasDraft,
  };
  state.v = v;
  state.headId = entry.id;
  state.docs = plan.docs;
  state.hasDraft = plan.hasDraft;
  state.log.push(entry);
  state.logBytes += plan.bytes;
  trimLog(state);
  if (src !== null) {
    state.clients.set(src.clientId, { seq: src.seq, outcome: "applied", at: now });
  }
  return entry;
}

/**
 * Record a refusal against the item's seq when it is terminal, so a resend is
 * answered with the same refusal. A retryable refusal is not recorded: the
 * resend gets decided again.
 */
export function recordRefusal(state: SequencerState, src: EntrySource, refusal: Refusal, now: number): NackMessage {
  const reply = nackOf(src.seq, refusal.code, refusal.detail);
  if (!reply.retryable) {
    assertNewSeq(state, src);
    state.clients.set(src.clientId, { seq: src.seq, outcome: "rejected", code: refusal.code, at: now });
  }
  return reply;
}

/**
 * The reply to an item that was already decided, or null for a new item. A
 * seq at or below the client's watermark is a duplicate: it gets `ack` when
 * the watermark records it applied, else the recorded refusal. Under
 * stop-and-wait a client has only its watermark's seq outstanding, so a seq
 * below it is a stale resend whose reply the client ignores.
 */
export function decideDuplicate(state: SequencerState, src: EntrySource): AckMessage | NackMessage | null {
  const last = state.clients.get(src.clientId);
  if (last === undefined || src.seq > last.seq) {
    return null;
  }
  if (last.outcome === "applied") {
    return { type: "ack", seq: src.seq, v: state.v };
  }
  const code = last.code ?? "invalid";
  return nackOf(src.seq, code, "this change was already refused");
}

/** A client's watermark for its welcome, without the server's bookkeeping. */
export function watermarkOf(state: SequencerState, clientId: string): Watermark | null {
  const record = state.clients.get(clientId);
  if (record === undefined) {
    return null;
  }
  return record.outcome === "applied"
    ? { seq: record.seq, outcome: "applied" }
    : { seq: record.seq, outcome: "rejected", code: record.code ?? "invalid" };
}

export type WelcomeDecision = { kind: "catchup"; entries: Entry[] } | { kind: "snapshot"; diverged: boolean };

/**
 * How a client that last applied `have` catches up: with the entries after
 * it when `have` is the head or an entry still in the log, else with a
 * snapshot. `diverged` means the client applied an entry this scene does not
 * have: one past the head, or a different entry at the same number (a crash
 * lost the original and a new one took its number).
 */
export function decideWelcome(state: SequencerState, have: EntryRef | null): WelcomeDecision {
  if (have === null) {
    return { kind: "snapshot", diverged: false };
  }
  if (have.v > state.v) {
    return { kind: "snapshot", diverged: true };
  }
  if (have.v === state.v) {
    return have.id === state.headId ? { kind: "catchup", entries: [] } : { kind: "snapshot", diverged: true };
  }
  const first = state.log[0];
  if (first === undefined || have.v < first.v) {
    return { kind: "snapshot", diverged: false };
  }
  const known = state.log[have.v - first.v]!;
  assert(known.v === have.v, "the log is contiguous");
  if (known.id !== have.id) {
    return { kind: "snapshot", diverged: true };
  }
  return { kind: "catchup", entries: state.log.slice(have.v - first.v + 1) };
}

/** Drop the oldest entries until the log is within `LOG_MAX_ENTRIES` and `LOG_MAX_BYTES`. */
function trimLog(state: SequencerState): void {
  let drop = 0;
  let bytes = state.logBytes;
  while (drop < state.log.length && (state.log.length - drop > LOG_MAX_ENTRIES || bytes > LOG_MAX_BYTES)) {
    bytes -= entryBytes(state.log[drop]!);
    drop++;
  }
  if (drop > 0) {
    state.log.splice(0, drop);
    state.logBytes = bytes;
  }
}

function entryBytes(entry: Entry): number {
  return (
    (entry.changes.draft ? opsSize(entry.changes.draft) : 0) +
    (entry.changes.published ? opsSize(entry.changes.published) : 0)
  );
}

// ---------------------------------------------------------------------------
// Persistence

/**
 * The client records worth keeping: seen within `CLIENT_RETENTION_MS` of
 * `now`, and only the `CLIENT_RETENTION_COUNT` most recent. A client whose
 * record is dropped and later resends an old item has it treated as new;
 * after this long its editor has long since closed.
 */
export function retainedClients(clients: Map<string, ClientRecord>, now: number): Record<string, ClientRecord> {
  const recent = [...clients.entries()]
    .filter(([, record]) => now - record.at <= CLIENT_RETENTION_MS)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, CLIENT_RETENTION_COUNT);
  const retained: Record<string, ClientRecord> = {};
  for (const [clientId, record] of recent) {
    retained[clientId] = { ...record };
  }
  return retained;
}

/** What to persist alongside the documents: the head and the retained watermarks. */
export function editorStateOf(state: SequencerState, now: number): EditorState {
  return { v: state.v, headId: state.headId, clients: retainedClients(state.clients, now) };
}

export function encodeEditorState(editorState: EditorState): string {
  return JSON.stringify(editorState);
}

/**
 * The persisted editor state. A scene saved before there was one (null or
 * empty column) starts from `EMPTY_EDITOR_STATE`; anything else that does
 * not parse is an error for the caller to decide on.
 */
export function decodeEditorState(
  json: string | null | undefined
): { ok: true; state: EditorState } | { ok: false; error: string } {
  if (json === null || json === undefined || json === "") {
    return { ok: true, state: { v: 0, headId: "", clients: {} } };
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `editor state is not JSON: ${errorText(err)}` };
  }
  if (
    !isPlainObject(value) ||
    !Number.isSafeInteger(value.v) ||
    (value.v as number) < 0 ||
    typeof value.headId !== "string" ||
    !isPlainObject(value.clients)
  ) {
    return { ok: false, error: "editor state needs v, headId and clients" };
  }
  const clients: Record<string, ClientRecord> = {};
  for (const [clientId, record] of Object.entries(value.clients)) {
    if (!isClientRecord(record)) {
      return { ok: false, error: `editor state has an invalid record for client ${clientId}` };
    }
    clients[clientId] =
      record.outcome === "applied"
        ? { seq: record.seq, outcome: "applied", at: record.at }
        : { seq: record.seq, outcome: "rejected", code: record.code, at: record.at };
  }
  return { ok: true, state: { v: value.v as number, headId: value.headId, clients } };
}

function isClientRecord(value: unknown): value is ClientRecord {
  if (!isPlainObject(value) || !Number.isSafeInteger(value.seq) || (value.seq as number) < 1) {
    return false;
  }
  if (typeof value.at !== "number" || !Number.isFinite(value.at)) {
    return false;
  }
  if (value.outcome === "applied") {
    return true;
  }
  return (
    value.outcome === "rejected" &&
    (value.code === "invalid" || value.code === "stale_base" || value.code === "unavailable")
  );
}

// ---------------------------------------------------------------------------

function assertNewSeq(state: SequencerState, src: EntrySource): void {
  const last = state.clients.get(src.clientId);
  assert(last === undefined || src.seq > last.seq, "an item is decided once: its seq is above the client's watermark");
}

function assert(condition: boolean, invariant: string): asserts condition {
  if (!condition) {
    throw new Error(`scene editor sequencer invariant violated: ${invariant}`);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
