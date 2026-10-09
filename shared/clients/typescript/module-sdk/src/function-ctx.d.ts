// Type declarations for the function `ctx` object passed to barkloader
// module function entry points.
//
// JS authors get hovers + autocomplete by referencing this file once at
// the top of the function file:
//
//   /// <reference types="@woofx3/module-sdk/function-ctx" />
//
//   /** @param {import("@woofx3/module-sdk/function-ctx").Ctx} ctx */
//   function increment(ctx) {
//     ctx.storage.set("count", (ctx.storage.get("count") || 0) + 1);
//   }
//
// TS authors import the type directly:
//
//   import type { Ctx } from "@woofx3/module-sdk/function-ctx";
//
// SOURCE OF TRUTH: this file mirrors what the QuickJS adapter at
// `barkloader/lib_sandbox/src/runtime/quickjs.rs:185-517` and the Lua
// adapter at `barkloader/lib_sandbox/src/runtime/lua.rs:63-255` actually
// register on the ctx object. The drift test at
// `tests/function-ctx-drift.test.ts` scans the Rust source on every
// run and asserts every registered key appears here.

/**
 * One runtime-instance row owned by some module's declared kind.
 * Returned by `ctx.resources.create` and `ctx.resources.list`.
 *
 * Mirrors `ResourceInstance` in
 * `barkloader/lib_sandbox/src/host/mod.rs:36-43`.
 */
export interface ResourceInstance {
  canonical_id: string;
  module_name: string;
  kind: string;
  instance_id: string;
  display_name: string;
  /** What the instance was created with: its kind's `schema` field values. */
  settings: Record<string, unknown>;
}

/**
 * Response shape from `ctx.http.request`. The exact shape is determined
 * by the engine's HTTP adapter — the engine never re-validates, so we
 * type permissively. Callers that know the response format should narrow
 * with their own type.
 */
export interface CtxHttpResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Options passed to `ctx.http.request`. Open-ended on purpose — the
 * engine forwards the JSON to whichever HTTP client it's wired to.
 * Common keys: `headers`, `body`, `timeoutMs`, `query`.
 */
export interface CtxHttpOptions {
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
  [k: string]: unknown;
}

/**
 * `ctx.crypto` — signature primitives for verifying inbound webhook
 * requests. Pure computation; nothing here reaches the engine.
 */
export interface CtxCrypto {
  /**
   * HMAC of `data` under `key` (both UTF-8). Returns the digest in
   * `encoding` (default "hex"). Throws for an unknown algorithm or encoding.
   */
  hmac(algorithm: "sha1" | "sha256" | "sha512", key: string, data: string, encoding?: "hex" | "base64"): string;
  /**
   * Ed25519 signature check. `publicKey` and `signature` are in `encoding`
   * (default "hex"); `message` is UTF-8. Throws for a malformed public key;
   * a malformed or non-matching signature is simply `false`.
   */
  verifyEd25519(publicKey: string, signature: string, message: string, encoding?: "hex" | "base64"): boolean;
  /** Constant-time string comparison. Different lengths compare unequal. */
  timingSafeEqual(a: string, b: string): boolean;
}

/** `ctx.event.data` for a webhook handler: the inbound HTTP request. */
export interface WebhookRequest {
  method: "GET" | "POST";
  /** Lowercased names; every request header except `cookie`. */
  headers: Record<string, string>;
  /** One value per key (the first occurrence). */
  query: Record<string, string>;
  /** The parsed JSON body, or `null` when the body is not JSON. */
  body: unknown;
  /** The body as UTF-8, exactly as received. Check signatures against this, not `body`. */
  rawBody: string;
}

/**
 * What a webhook handler returns. The engine validates it before acting on
 * it: a result that breaks any rule below is a 500 and publishes nothing.
 */
export interface WebhookHandlerResult {
  /** An integer from 200 to 599. */
  status: number;
  /** Only `content-type` and `x-*` names. */
  headers?: Record<string, string>;
  /** A string is sent as-is; an object or array is sent as JSON. At most 64 KiB. */
  body?: string | Record<string, unknown> | unknown[];
  /**
   * Events for the engine to publish, allowed only with a 2xx status. Each
   * `type` must be the `event` of an eventbus trigger this module declares.
   * At most 16; each `data` at most 64 KiB serialized.
   */
  events?: { type: string; data?: Record<string, unknown> }[];
}

/**
 * `ctx.storage` — module-scoped persistent KV. Every key belongs to the calling
 * module: two modules using the same key hold two separate values. Reads and
 * writes are synchronous to the function. Every successful write auto-emits a
 * `module.storage.<moduleId>.changed` NATS event so widgets and other
 * subscribers see the update.
 */
export interface CtxStorage {
  get(key: string): unknown;
  set(key: string, value: unknown, options?: CtxStorageSetOptions): void;
  /**
   * Write `value` only if the key holds `expected` right now — or holds nothing,
   * when `expected` is null — in one step. The safe way to update a value from
   * its previous one (a counter, a queue) when two invocations may do it at
   * once; `get` then `set` can lose one of the two writes.
   *
   * `current` is what the key holds afterwards: the value just written, or the
   * one that stopped the write, which is what to retry from.
   */
  compareAndSet(key: string, expected: unknown, value: unknown, options?: CtxStorageSetOptions): CtxCompareAndSetResult;
}

export interface CtxCompareAndSetResult {
  swapped: boolean;
  current: unknown;
}

/** How the engine should treat a stored value beyond its bytes. */
export interface CtxStorageSetOptions {
  /**
   * Drop this key when the stream session ends. A session spans brief
   * dropouts, so this is not the same as the stream going offline — a
   * reconnect keeps the value.
   *
   * The module only declares the intent; the engine does the clearing, because
   * the sandbox exposes no way to delete storage. Defaults to false: a key
   * that outlives a session can still be cleared later, one wrongly dropped is
   * gone.
   */
  clearOnSessionEnd?: boolean;
}

/**
 * `ctx.http` — outbound HTTP client. It reaches only hosts the manifest
 * declares as `"permissions": ["net:<host>"]` (https, port 443) and the
 * origins of URLs the streamer entered in `type: "url"` settings; anything
 * else throws `permission_denied` on an engine that enforces it. Redirects
 * are followed and checked the same way.
 */
export interface CtxHttp {
  request(url: string, method: string, opts?: CtxHttpOptions): CtxHttpResponse;
}

/**
 * `ctx.log` — forwards to the host's log, prefixed with the calling
 * module's id. There is no `console` global in this sandbox; this is the
 * only way for a module function to emit a log line. Strings are logged
 * verbatim; any other value is JSON-encoded first.
 *
 * Takes exactly one argument, unlike `console.log(a, b, c)`. Plain-JS
 * callers not type-checking against this signature get no error for
 * `ctx.log.info('label', data)` — the extra argument is silently dropped
 * by the sandbox host binding, not logged. Combine values yourself:
 * `ctx.log.info({ label: 'data', value: data })`.
 */
export interface CtxLog {
  info(value: unknown): void;
  warn(value: unknown): void;
  error(value: unknown): void;
}

/**
 * The standard shape a function returns to report an outcome and a message.
 * It becomes the calling `function` step's output, read by later steps as
 * `${<stepId>.message}`; the engine never sends `message` anywhere itself, so
 * a chat command that answers in chat follows the step with `chat.reply`.
 * `proto`/`v` mirror the `woofx3.widget`/`woofx3.overlay-events` envelope
 * convention, letting a reader of the step output recognize a deliberate
 * ctx.response() result versus any other object a function might return.
 */
export interface CtxResponse {
  proto: "woofx3.response";
  v: 1;
  success: boolean;
  message: string;
}

/** One event a function asks the engine to publish. */
export interface CtxResultEvent {
  /** The `event` of an eventbus trigger this module declares. */
  type: string;
  data?: Record<string, unknown>;
}

/**
 * A function's result together with events it asks the engine to publish.
 * The function never publishes: when it returns this, the engine checks the
 * events (declared types only, at most 16, each `data` at most 64 KiB),
 * publishes them, and hands `value` to the caller as the function's result.
 * A rule broken fails the call and publishes nothing.
 */
export interface CtxResult<T = unknown> {
  proto: "woofx3.result";
  v: 1;
  value: T;
  events: CtxResultEvent[] | null;
}

/**
 * `ctx.resources` — runtime-instance lifecycle for kinds the calling
 * module declared in its manifest's `resources[]` block.
 *
 * `create` returns a `ResourceInstance` whose `canonical_id` is the
 * stable handle for `delete` and for `resource_ref` ConfigField values
 * in workflows / commands.
 */
export interface CtxResources {
  create(kind: string, instanceId: string, displayName?: string, settings?: Record<string, unknown>): ResourceInstance;
  delete(canonicalId: string): void;
  /** One instance, settings included, or null when nothing has the id. */
  get(canonicalId: string): ResourceInstance | null;
  list(kind: string): ResourceInstance[];
  /**
   * Run the `{kind}.{verb}` action of the module that provides the
   * instance's kind, on that instance, as that module:
   * `run(timer, "add", { seconds: 60 })` runs `woofx3:action:timer.add`
   * with `target: timer`. Returns what the action returns.
   *
   * Allowed on an instance this module owns or one its settings link to
   * (a `resource_ref` setting); this module must declare every permission
   * the providing module does. Throws on refusal or failure.
   */
  run(canonicalId: string, verb: string, params?: Record<string, unknown>): unknown;
  /**
   * Write `settings[key]` on an instance this module owns, only while it
   * still holds `expected`: the safe way to change a setting the streamer,
   * or another run, may be changing at the same moment, such as adding an
   * entry to a `list` field of the kind's `schema`. Compared by meaning
   * (key order, `1` vs `1.0`, `[]` vs `{}` don't matter), so pass back what
   * you read from `get(canonicalId).settings[key]`. `undefined` or `null`
   * matches a key the instance does not hold, which is how a field the
   * streamer never saved reads.
   *
   * Answers `{ swapped, current }`: `current` is the setting as it reads now
   * (the value written, or the one that stopped the write, to retry from),
   * `undefined` when the instance does not hold the key. A swap is announced
   * as an instance update, the same as a streamer's edit. Throws for an
   * instance another module owns, an instance that does not exist, or a
   * value JSON cannot hold.
   */
  compareAndSetSetting(
    canonicalId: string,
    key: string,
    expected: unknown,
    value: unknown,
  ): CtxCompareAndSetSettingResult;
}

/**
 * `ctx.schedule` — one-shot invocations of a function this module declares
 * under the manifest's `deadlines`. An entry is identified by
 * `(deadlineId, key)`; the module is implied.
 *
 * Entries are kept in memory only and are dropped when the module is
 * reloaded, upgraded, disabled or uninstalled. A module keeps the durable
 * truth in its own storage and re-arms from it in a `runOnLoad` background
 * task, so a stale or repeated firing must be harmless to it. Deleting a
 * resource instance cancels every entry whose key is its canonical id.
 */
export interface CtxSchedule {
  /**
   * Arm `key` to invoke the deadline's function at `whenMs` (Unix epoch
   * milliseconds), replacing any entry already under that key. A time in the
   * past fires as soon as possible. The fired function receives `params` as
   * `ctx.event.parameters` and the firing as `ctx.event.deadline`
   * (`DeadlineFiring`).
   *
   * Throws for an undeclared `deadlineId`, a non-finite `whenMs`, a `whenMs`
   * more than 30 days out, `params` over 4 KiB serialized, or a deadline
   * already holding its `maxPending` entries.
   */
  at(deadlineId: string, key: string, whenMs: number, params?: unknown): void;
  /** Drop the entry under `key`. Cancelling nothing is not an error. */
  cancel(deadlineId: string, key: string): void;
}

/** `ctx.event.deadline` when a function runs because a deadline came due. */
export interface DeadlineFiring {
  /** The deadline id from the manifest. */
  id: string;
  /** The key the entry was armed under. */
  key: string;
  /** Epoch milliseconds the entry was armed for. */
  dueAt: number;
  /** Epoch milliseconds it actually fired. */
  firedAt: number;
}

/**
 * `ctx.module` — identity and configured settings of the module the
 * invoking function belongs to.
 *
 * `settings` has one key per `module_settings` row registered for this
 * module (declared in the manifest's `settings[]` block), coerced to a
 * native `string` / `number` / `boolean` based on each setting's
 * declared type. A setting with no value configured yet still appears,
 * resolved to its manifest `default` (or the type's zero value).
 */
export interface CtxModule {
  /** Manifest-local module id, e.g. `"spotify"`. */
  id: string;
  /** Display name from the manifest. */
  name: string;
  /** Semver string from the manifest. */
  version: string;
  /**
   * The module's settings, coerced from each setting's declared type: a
   * `list` setting reads as its rows, an array of objects keyed by the
   * setting's `itemFields` ids (`[]` when it has none).
   */
  settings: Record<string, string | number | boolean | Record<string, unknown>[]>;
  /**
   * Write one of this module's settings. Takes effect immediately.
   *
   * Values are written as strings, while `settings` above reads back
   * `string` / `number` / `boolean` coerced from each setting's declared type.
   * `settings` is also a snapshot taken once per invocation, so a value written
   * here is not reflected back into the object already handed to the function.
   *
   * The key does not have to be declared in the manifest.
   */
  setSetting(key: string, value: string): void;
  /**
   * Write one of this module's settings only while it still holds `expected`,
   * as this module reads it: the safe way to change a setting that another
   * run, or the streamer, may be changing at the same moment, such as adding
   * a row to a `list` setting.
   *
   * `expected` is compared by meaning, not by text, so the array read from
   * `settings` matches the stored list however it was saved. `value` is
   * stored as is when it is a string and as JSON otherwise; a `list` setting
   * takes only an array.
   *
   * Answers `{ swapped, current }`: `current` is the setting as it reads now
   * (the value written, or the one that stopped the write, to retry from),
   * `null` when the module has no such setting. Like `setSetting`, it does
   * not refresh `settings`. Refused for a `url` or `secret` setting.
   */
  compareAndSetSetting(key: string, expected: unknown, value: unknown): CtxCompareAndSetSettingResult;
}

export interface CtxCompareAndSetSettingResult {
  swapped: boolean;
  current: unknown;
}

// ── Extensions ──────────────────────────────────────────────────────
//
// Extension namespaces are bound conditionally per engine deployment.
// Their presence on `ctx` depends on which `HostExtension`s the engine
// constructed. We declare them as optional namespaces so authors who
// know they're available get autocomplete; authors writing portable
// modules check `if (ctx.twitch) …` first.
//
// Source: `barkloader/lib_sandbox/src/extensions/{twitch,obs,chat}.rs`.
// To add a new extension, declare
// the namespace + its function names below.

/**
 * What an extension function throws when the host refuses or fails the
 * call: an `Error` whose `message` says why, with `code` set when there is
 * a reason to branch on. Lua raises a table `{ message, code? }` whose
 * `tostring` is the message.
 */
export interface CtxHostError extends Error {
  /**
   * `permission_denied`: the manifest does not declare the permission the
   * function needs. `ctx.twitch` adds:
   * - `timeout`: the function's run is out of time, or the twitch service did
   *   not answer within 10s (the action may still have happened)
   * - `call_limit`: the run already made 10 `ctx.twitch` calls
   * - `busy`: too many twitch requests are waiting across the engine
   * - `unavailable`: the twitch service is not running
   * - `request_failed`: the request could not be sent or its reply read
   *
   * Absent when the twitch service refused (invalid input, Twitch not linked,
   * Twitch's own error): those carry only a message.
   *
   * `ctx.obs` uses `timeout`, `call_limit`, `busy` and `request_failed` the
   * same way, `unavailable` when no scene manager is running, and
   * `invalid_arguments` for a call it refuses before asking. A refusal from
   * OBS (not connected, no scene by that name) carries only its message.
   */
  code?: string;
}

export interface TwitchUserTarget {
  userId?: string;
  /** Login name, used when `userId` is absent. */
  userName?: string;
}

/**
 * `ctx.twitch.*`: registered when `TwitchExtension` is bound. Each call asks
 * the twitch service to act (a request on NATS subject `twitchapi`), waits
 * up to 10 seconds (never past the end of the function's run), and returns
 * its result. A function may make at most 10 calls per run. A refusal
 * (invalid input, Twitch not linked, Twitch's own error) throws a
 * `CtxHostError` carrying the twitch service's message.
 *
 * `timeout` and `updateStream` are privileged: the module's manifest must
 * declare `"permissions": ["twitch.moderation"]` or `["twitch.channel"]`
 * respectively, or the call throws `permission_denied` without reaching
 * Twitch.
 */
export interface CtxTwitchExtension {
  /** Clip the live stream. */
  clip(): { id: string; url: string };
  /**
   * Twitch's own shoutout of another channel. It joins the dashboard's
   * shoutout queue, which sends one every 2 minutes and retries refusals, so
   * `queued` with the 1-based `position` (and `alreadyQueued` when the user was
   * waiting already). An engine with no dashboard queue sends it at once
   * instead (`queued: false`), and Twitch's rate limit throws `rate_limited`.
   */
  shoutout(
    args: TwitchUserTarget
  ):
    | { ok: true; userId: string; queued: true; position: number; alreadyQueued: boolean }
    | { ok: true; userId: string; queued: false };
  /** Place a stream marker. Throws while the channel is offline: Twitch
   *  only marks a live stream. Description at most 140 characters. */
  createMarker(args?: { description?: string }): {
    id: string;
    /** ISO 8601. */
    createdAt: string;
    description: string;
    /** How far into the broadcast the marker sits. */
    positionSeconds: number;
  };
  /**
   * Look a Twitch user up: their profile, what their channel is set to, and
   * their stream while they are live. The category is the channel's current
   * one, which Twitch keeps after a stream ends, so it is what they last
   * streamed. Throws when no user has that id or name.
   */
  getUser(args: TwitchUserTarget): {
    userId: string;
    login: string;
    displayName: string;
    description: string;
    profileImageUrl: string;
    /** "partner", "affiliate" or "" for neither. */
    broadcasterType: string;
    /** When the account was created, ISO 8601. */
    createdAt: string;
    title: string;
    categoryId: string;
    categoryName: string;
    tags: string[];
    language: string;
    isLive: boolean;
    /** Null while offline. `startedAt` is ISO 8601. */
    stream: { title: string; categoryName: string; viewerCount: number; startedAt: string } | null;
  };
  /** Time a chatter out for 1 to 1209600 seconds. Needs `twitch.moderation`. */
  timeout(args: TwitchUserTarget & { durationSeconds: number; reason?: string }): {
    ok: true;
    userId: string;
    durationSeconds: number;
  };
  /**
   * Change the title (at most 140 characters), category or tags (at most 10,
   * each up to 25 letters or numbers). `category` is free text resolved
   * through Twitch's category search; `categoryId` is used as given and ""
   * clears it. Needs `twitch.channel`.
   */
  updateStream(args: { title?: string; category?: string; categoryId?: string; tags?: string[] }): {
    ok: true;
    title?: string;
    categoryId?: string;
    /** Present when the category was resolved from free text. */
    categoryName?: string;
    tags?: string[];
  };
}

/** One OBS name, in the shape a field-options function returns. */
export interface ObsNameOption {
  /** The name exactly as OBS shows it. */
  value: string;
  label: string;
  /** The heading the option is listed under, such as the scene a source is in. */
  group?: string;
}

/**
 * `ctx.obs.*`: registered when `ObsExtension` is bound. Each call asks the
 * scene manager, which holds the engine's OBS connection, to change OBS or
 * list its names, waits up to 5 seconds (never past the end of the function's
 * run), and returns its answer. A function may make at most 10 calls per run.
 * A refusal (OBS not connected, a name OBS does not have) throws a
 * `CtxHostError` carrying OBS's reason, which a field-options function can
 * return as `{ error }` so the picker says why it is empty.
 *
 * Names are OBS's own, case included. The changes (`switchScene`,
 * `setSourceVisibility`, `setInputMute`, `showBrowserSource`) need
 * `"permissions": ["obs.control"]` in the manifest, or the call throws
 * `permission_denied` without reaching OBS; listing needs none.
 */
export interface CtxObsExtension {
  /** Make a scene the live program scene. Needs `obs.control`. */
  switchScene(args: { sceneName: string }): { ok: true };
  /**
   * Show or hide a source in a scene, the live program scene when `sceneName`
   * is absent or empty. `visible` defaults to true and also accepts "true" and
   * "false". Needs `obs.control`.
   */
  setSourceVisibility(args: { sourceName: string; sceneName?: string; visible?: boolean | "true" | "false" }): {
    ok: true;
  };
  /**
   * Mute or unmute an audio input. `muted` defaults to true and also accepts
   * "true" and "false". Needs `obs.control`.
   */
  setInputMute(args: { inputName: string; muted?: boolean | "true" | "false" }): { ok: true };
  /**
   * Show a web page in a browser source in a scene, the live program scene
   * when `sceneName` is absent or empty. `url` must be an absolute http:// or
   * https:// URL.
   *
   * When OBS has a browser source named `sourceName`, it is pointed at `url`
   * (its other settings are kept), added to the scene if it is not in it, and
   * made visible. When OBS has no input by that name, a browser source is
   * created in the scene at `width` x `height` (default 1920 x 1080, at most
   * 7680 x 4320; whole numbers, also accepted as text); the size is not
   * changed on an existing source. An input of another kind by that name is
   * refused, not replaced. Needs `obs.control`.
   */
  showBrowserSource(args: {
    sourceName: string;
    url: string;
    sceneName?: string;
    width?: number | string;
    height?: number | string;
  }): { ok: true };
  /** OBS's scenes. */
  listScenes(): ObsNameOption[];
  /** OBS's sources, grouped by the scene they are in. */
  listSources(): ObsNameOption[];
  /** OBS's audio inputs. */
  listInputs(): ObsNameOption[];
}

/** `ctx.chat.*` — registered when `ChatExtension` is bound. */
export interface CtxChatExtension {
  /** Send a message via the engine-bound chat sender. */
  sendMessage(text: string): null;
}

/**
 * `ctx.oauth.*` — requests to a provider the manifest declares under
 * `oauth[]`, with the streamer's token, which module code never sees. The
 * engine attaches the token, refreshes it, and sends it only to the
 * integration's `hosts`. Throws when the integration is not connected yet.
 */
export interface CtxOAuthExtension {
  request(args: {
    /** The `id` of an integration in the manifest's `oauth[]`. */
    integration: string;
    url: string;
    /** Defaults to `GET`. */
    method?: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
  }): CtxHttpResponse;
}

/** Aggregated extension surface. Each namespace optional. */
export interface CtxExtensions {
  twitch?: CtxTwitchExtension;
  obs?: CtxObsExtension;
  chat?: CtxChatExtension;
  oauth?: CtxOAuthExtension;
}

/**
 * The `ctx` object passed to every function invocation. Combines the
 * built-in surface (event, user, events, storage, http, resources,
 * schedule, module, log, response, result) with any extension namespaces the host registered.
 *
 * `event` and `user` are typed as `unknown` because their shape is
 * determined by the trigger that fired the function — the author knows
 * which trigger they wired and should narrow accordingly:
 *
 *   const { userName, amount } = ctx.event.data ?? {};
 */
export interface Ctx extends CtxExtensions {
  /** The triggering CloudEvent's payload, opaque at this boundary. */
  event: unknown;
  /** The user context the host attached, opaque at this boundary. */
  user: unknown;
  crypto: CtxCrypto;
  storage: CtxStorage;
  http: CtxHttp;
  resources: CtxResources;
  schedule: CtxSchedule;
  module: CtxModule;
  log: CtxLog;
  /**
   * Builds the standard response shape to `return` as the step's output.
   * See `CtxResponse`. `message` is required — a function with nothing to
   * report returns `null`/`undefined`, or nothing. `success` reports the
   * outcome; it does not stop the steps that follow.
   */
  response(success: boolean, message: string): CtxResponse;
  /**
   * Builds the shape to `return` when the function's work is something
   * workflows should be able to act on — a counter changed, a timer ended.
   * See `CtxResult`.
   */
  result<T>(value: T, events?: CtxResultEvent[]): CtxResult<T>;
}

/**
 * The expected entry-point signature for a function file. The host
 * loads the file, calls the named export with `ctx`, and writes the
 * return value into the workflow execution's `taskExports` map (keyed
 * by the task id).
 *
 * Async functions are supported — the host awaits the returned
 * promise.
 */
export type FunctionEntry<R = unknown> = (ctx: Ctx) => R | Promise<R>;
