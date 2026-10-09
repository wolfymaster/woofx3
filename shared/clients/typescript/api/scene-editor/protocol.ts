// The scene editor socket, protocol version 2.
//
// `GET /scene/{sceneId}/edit?token=...&protocol=2` opens it. Each client
// keeps one ordered queue of items across both versions of the scene and has
// at most one item in flight; every item carries `(clientId, seq)`, and the
// server remembers the last seq it decided for each client, so a resend is
// answered without being applied twice. The server sends, per socket, in
// commit order: every entry with `v <= x` is sent before any reply whose
// decision saw head `x`.

import {
  type Entry,
  type EntryKind,
  type EntrySource,
  isPlainObject,
  isSceneDocument,
  isVersion,
  type MetaChanges,
  type Ops,
  type PlacementMeta,
  type SceneDocument,
  type Version,
} from "./document";

export const PROTOCOL_VERSION = 2;

/** The query parameter value a v2 client opens the socket with. */
export const PROTOCOL_QUERY = "protocol=2";

/** Close codes the server ends a session with, after an `error` message where one is named. */
export const CLOSE_CODES = {
  /** A message was not valid protocol (`error` code `protocol`). */
  protocol: 4400,
  /** The scene does not exist or could not be loaded (`error` code `not_found`). */
  notFound: 4404,
  /** A newer socket said hello with the same clientId. */
  replaced: 4409,
  /** The client asked for a protocol the server does not speak (`error` code `unsupported_protocol`). */
  unsupportedProtocol: 4426,
} as const;

/** Why an item was refused. A refusal guarantees no document changed. */
export type NackCode = "invalid" | "stale_base" | "unavailable";

/**
 * Whether resending the same item can succeed:
 * - `invalid`: bad shape, ops that do not apply, or too large. Terminal; the
 *   server records the rejection against the item's seq.
 * - `stale_base`: the item's base is older than the server's log. The client
 *   reconnects and the welcome snapshot rebases it.
 * - `unavailable`: something failed before the commit. The client resends the
 *   same seq after a backoff.
 */
export const NACK_RETRYABLE: Readonly<Record<NackCode, boolean>> = {
  invalid: false,
  stale_base: true,
  unavailable: true,
};

/** Session-level failures, each followed by a close (see `CLOSE_CODES`). */
export type SessionErrorCode = "not_found" | "unsupported_protocol" | "protocol";

export const SESSION_ERROR_CLOSE_CODES: Readonly<Record<SessionErrorCode, number>> = {
  not_found: CLOSE_CODES.notFound,
  unsupported_protocol: CLOSE_CODES.unsupportedProtocol,
  protocol: CLOSE_CODES.protocol,
};

/** The last entry a client applied. */
export interface EntryRef {
  v: number;
  id: string;
}

export type ItemBody = { kind: "edit"; version: Version; ops: Ops } | { kind: "publish" } | { kind: "discard" };

/** The server's record of the last item it decided for a client. */
export interface Watermark {
  seq: number;
  outcome: "applied" | "rejected";
  /** Why it was rejected; set only when `outcome` is `rejected`. */
  code?: NackCode;
}

/** Everything an editor needs to start over from the scene as it stands. */
export interface EditorSnapshot {
  v: number;
  id: string;
  docs: Record<Version, SceneDocument>;
  meta: Record<Version, Record<string, PlacementMeta>>;
  hasDraft: boolean;
  name: string;
}

// ---------------------------------------------------------------------------
// Client to server

/** First message on every socket. `have` is the last entry the client applied, or null for none. */
export interface HelloMessage {
  type: "hello";
  protocol: typeof PROTOCOL_VERSION;
  clientId: string;
  have: EntryRef | null;
  name: string;
}

/**
 * One queued change. A resend keeps `seq`; its ops may have been transformed
 * and `base` moved forward since the first send.
 */
export interface ItemMessage {
  type: "item";
  seq: number;
  base: number;
  body: ItemBody;
}

/** Fire-and-forget and unsequenced. `away` hides the client from others while it drains. */
export type ClientPresenceMessage =
  | { type: "presence"; selection: string | null; version: Version }
  | { type: "presence"; away: true };

export type ClientMessage = HelloMessage | ItemMessage | ClientPresenceMessage;

// ---------------------------------------------------------------------------
// Server to client

interface WelcomeBase {
  type: "welcome";
  protocol: typeof PROTOCOL_VERSION;
  /** Minor additions to protocol 2 this server supports. */
  features: string[];
  clientId: string;
  last: Watermark | null;
}

/** The client's `have` is in the server's log: the entries after it follow. */
export interface WelcomeCatchup extends WelcomeBase {
  catchup: Entry[];
}

/**
 * The client starts over from `snapshot`. `diverged` means the client had
 * applied entries the server no longer has (lost in a crash).
 */
export interface WelcomeSnapshot extends WelcomeBase {
  snapshot: EditorSnapshot;
  diverged: boolean;
}

export type WelcomeMessage = WelcomeCatchup | WelcomeSnapshot;

/** Every committed change, to every editor including the submitter, whose own `src` is its acknowledgement. */
export interface EntryMessage extends Entry {
  type: "entry";
}

/** The item committed nothing: empty after transform, or a duplicate already reflected. `v` is the head it saw. */
export interface AckMessage {
  type: "ack";
  seq: number;
  v: number;
}

export interface NackMessage {
  type: "nack";
  seq: number;
  code: NackCode;
  retryable: boolean;
  detail: string;
}

export type ServerPresenceMessage =
  | { type: "presence"; clientId: string; name: string; selection: string | null; version: Version }
  | { type: "presence"; clientId: string; left: true };

export interface ErrorMessage {
  type: "error";
  code: SessionErrorCode;
  detail: string;
}

export type ServerMessage =
  | WelcomeMessage
  | EntryMessage
  | AckMessage
  | NackMessage
  | ServerPresenceMessage
  | ErrorMessage;

export function isWelcomeSnapshot(message: WelcomeMessage): message is WelcomeSnapshot {
  return "snapshot" in message;
}

export function nackOf(seq: number, code: NackCode, detail: string): NackMessage {
  return { type: "nack", seq, code, retryable: NACK_RETRYABLE[code], detail };
}

// ---------------------------------------------------------------------------
// Parsing. Every message from the other side is checked here before it is
// used; anything that does not match is a protocol error. Item ops are only
// checked to be a list: whether they are valid ops for the scene is the
// sequencer's decision, and its refusal (`invalid`) names the item.

const MAX_CLIENT_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 256;
const MAX_SELECTION_LENGTH = 256;

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isClientId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_CLIENT_ID_LENGTH;
}

function isNackCode(value: unknown): value is NackCode {
  return value === "invalid" || value === "stale_base" || value === "unavailable";
}

function isSessionErrorCode(value: unknown): value is SessionErrorCode {
  return value === "not_found" || value === "unsupported_protocol" || value === "protocol";
}

function isEntryKind(value: unknown): value is EntryKind {
  return value === "edit" || value === "publish" || value === "discard" || value === "external";
}

function isOps(value: unknown): value is Ops {
  return (
    Array.isArray(value) &&
    value.every((component) => isPlainObject(component) && Array.isArray(component.p) && component.p.length > 0)
  );
}

function isEntryRef(value: unknown): value is EntryRef {
  return isPlainObject(value) && isNonNegativeInteger(value.v) && typeof value.id === "string";
}

function isEntrySource(value: unknown): value is EntrySource {
  return isPlainObject(value) && isClientId(value.clientId) && isPositiveInteger(value.seq);
}

function isPlacementMeta(value: unknown): value is PlacementMeta {
  return (
    isPlainObject(value) &&
    typeof value.moduleId === "string" &&
    typeof value.hostsSurface === "string" &&
    typeof value.frameUrl === "string" &&
    isPlainObject(value.linkedResources)
  );
}

function isMetaChanges(value: unknown): value is MetaChanges {
  return isPlainObject(value) && Object.values(value).every((meta) => meta === null || isPlacementMeta(meta));
}

function isMetaRecord(value: unknown): value is Record<string, PlacementMeta> {
  return isPlainObject(value) && Object.values(value).every(isPlacementMeta);
}

function isPerVersion<T>(value: unknown, valid: (item: unknown) => item is T): value is Partial<Record<Version, T>> {
  return isPlainObject(value) && Object.entries(value).every(([key, item]) => isVersion(key) && valid(item));
}

function isBothVersions<T>(value: unknown, valid: (item: unknown) => item is T): value is Record<Version, T> {
  return isPerVersion(value, valid) && value.draft !== undefined && value.published !== undefined;
}

function isWatermark(value: unknown): value is Watermark {
  if (!isPlainObject(value) || !isPositiveInteger(value.seq)) {
    return false;
  }
  if (value.outcome === "applied") {
    return value.code === undefined;
  }
  return value.outcome === "rejected" && isNackCode(value.code);
}

export function isEntry(value: unknown): value is Entry {
  return (
    isPlainObject(value) &&
    isPositiveInteger(value.v) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (value.src === null || isEntrySource(value.src)) &&
    isEntryKind(value.kind) &&
    isPerVersion(value.changes, isOps) &&
    isPerVersion(value.meta, isMetaChanges) &&
    typeof value.hasDraft === "boolean"
  );
}

function isEditorSnapshot(value: unknown): value is EditorSnapshot {
  return (
    isPlainObject(value) &&
    isNonNegativeInteger(value.v) &&
    typeof value.id === "string" &&
    isBothVersions(value.docs, isSceneDocument) &&
    isBothVersions(value.meta, isMetaRecord) &&
    typeof value.hasDraft === "boolean" &&
    typeof value.name === "string"
  );
}

function parseItemBody(value: unknown): ItemBody | null {
  if (!isPlainObject(value)) {
    return null;
  }
  if (value.kind === "publish" || value.kind === "discard") {
    return { kind: value.kind };
  }
  if (value.kind === "edit" && isVersion(value.version) && Array.isArray(value.ops)) {
    return { kind: "edit", version: value.version, ops: value.ops as Ops };
  }
  return null;
}

/** A message a client sent, or null when it is not valid protocol 2. */
export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isPlainObject(value)) {
    return null;
  }
  switch (value.type) {
    case "hello": {
      if (
        value.protocol !== PROTOCOL_VERSION ||
        !isClientId(value.clientId) ||
        !(value.have === null || isEntryRef(value.have)) ||
        typeof value.name !== "string" ||
        value.name.length > MAX_NAME_LENGTH
      ) {
        return null;
      }
      return {
        type: "hello",
        protocol: PROTOCOL_VERSION,
        clientId: value.clientId,
        have: value.have === null ? null : { v: value.have.v, id: value.have.id },
        name: value.name,
      };
    }
    case "item": {
      const body = parseItemBody(value.body);
      if (!isPositiveInteger(value.seq) || !isNonNegativeInteger(value.base) || body === null) {
        return null;
      }
      return { type: "item", seq: value.seq, base: value.base, body };
    }
    case "presence": {
      if (value.away === true) {
        return { type: "presence", away: true };
      }
      const selection = value.selection;
      const validSelection =
        selection === null || (typeof selection === "string" && selection.length <= MAX_SELECTION_LENGTH);
      if (!validSelection || !isVersion(value.version)) {
        return null;
      }
      return { type: "presence", selection: selection as string | null, version: value.version };
    }
    default: {
      return null;
    }
  }
}

/** A message the server sent, or null when it is not valid protocol 2. */
export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isPlainObject(value)) {
    return null;
  }
  switch (value.type) {
    case "welcome": {
      if (
        value.protocol !== PROTOCOL_VERSION ||
        !Array.isArray(value.features) ||
        !value.features.every((feature) => typeof feature === "string") ||
        !isClientId(value.clientId) ||
        !(value.last === null || isWatermark(value.last))
      ) {
        return null;
      }
      const hasCatchup = Array.isArray(value.catchup) && value.catchup.every(isEntry);
      const hasSnapshot = isEditorSnapshot(value.snapshot) && typeof value.diverged === "boolean";
      if (hasCatchup === hasSnapshot) {
        return null;
      }
      return value as unknown as WelcomeMessage;
    }
    case "entry": {
      return isEntry(value) ? (value as unknown as EntryMessage) : null;
    }
    case "ack": {
      return isPositiveInteger(value.seq) && isNonNegativeInteger(value.v) ? (value as unknown as AckMessage) : null;
    }
    case "nack": {
      if (
        !isPositiveInteger(value.seq) ||
        !isNackCode(value.code) ||
        value.retryable !== NACK_RETRYABLE[value.code] ||
        typeof value.detail !== "string"
      ) {
        return null;
      }
      return value as unknown as NackMessage;
    }
    case "presence": {
      if (!isClientId(value.clientId)) {
        return null;
      }
      if (value.left === true) {
        return { type: "presence", clientId: value.clientId, left: true };
      }
      if (
        typeof value.name !== "string" ||
        !(value.selection === null || typeof value.selection === "string") ||
        !isVersion(value.version)
      ) {
        return null;
      }
      return {
        type: "presence",
        clientId: value.clientId,
        name: value.name,
        selection: value.selection as string | null,
        version: value.version,
      };
    }
    case "error": {
      if (!isSessionErrorCode(value.code) || typeof value.detail !== "string") {
        return null;
      }
      return { type: "error", code: value.code, detail: value.detail };
    }
    default: {
      return null;
    }
  }
}

/** `parseClientMessage` on a socket frame's text; null when it is not JSON either. */
export function decodeClientMessage(text: string): ClientMessage | null {
  return parseClientMessage(parseJson(text));
}

/** `parseServerMessage` on a socket frame's text; null when it is not JSON either. */
export function decodeServerMessage(text: string): ServerMessage | null {
  return parseServerMessage(parseJson(text));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
