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
// `barkloader/lib_sandbox/src/runtime/quickjs.rs:185-417` and the Lua
// adapter at `barkloader/lib_sandbox/src/runtime/lua.rs:63-192` actually
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

/** `ctx.events` — publish CloudEvents onto NATS. */
export interface CtxEvents {
  /**
   * Publish JSON `data` to NATS subject `subject`. Fire-and-forget; no
   * acknowledgement, no return value.
   */
  publish(subject: string, data: unknown): void;
}

/**
 * `ctx.storage` — module-scoped persistent KV. Reads and writes are
 * synchronous to the function. Every successful `set` auto-emits a
 * `module.storage.<moduleId>.changed` NATS event so widgets and other
 * subscribers see the update.
 */
export interface CtxStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

/** `ctx.http` — outbound HTTP client. */
export interface CtxHttp {
  request(url: string, method: string, opts?: CtxHttpOptions): CtxHttpResponse;
}

/** `ctx.env` — read environment variables the engine has been told it can expose. */
export interface CtxEnv {
  get(key: string): string | null;
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
  create(kind: string, instanceId: string, displayName?: string): ResourceInstance;
  delete(canonicalId: string): void;
  list(kind: string): ResourceInstance[];
}

// ── Extensions ──────────────────────────────────────────────────────
//
// Extension namespaces are bound conditionally per engine deployment.
// Their presence on `ctx` depends on which `HostExtension`s the engine
// constructed. We declare them as optional namespaces so authors who
// know they're available get autocomplete; authors writing portable
// modules check `if (ctx.twitch) …` first.
//
// Source: `barkloader/lib_sandbox/src/extensions/{twitch,chat,
// platform_alerts,platform_chat}.rs`. To add a new extension, declare
// the namespace + its function names below.

/** `ctx.twitch.*` — registered when `TwitchExtension` is bound. All
 *  methods publish a command envelope to NATS subject `twitchapi`. */
export interface CtxTwitchExtension {
  clip(args?: unknown): null;
  timeout(args: unknown): null;
  updateStream(args: unknown): null;
  addModerator(args: unknown): null;
}

/** `ctx.chat.*` — registered when `ChatExtension` is bound. */
export interface CtxChatExtension {
  /** Send a message via the engine-bound chat sender. */
  sendMessage(text: string): null;
}

/** `ctx.platform.alerts.*` — publishes to legacy `slobs` NATS subject. */
export interface CtxPlatformAlertsExtension {
  alert(args: unknown): null;
  setTimer(args: unknown): null;
}

/** `ctx.platform.chat.*` — publishes to `woofwoofwoof` NATS subject. */
export interface CtxPlatformChatExtension {
  register(args: unknown): null;
}

/** Aggregated extension surface. Each namespace optional. */
export interface CtxExtensions {
  twitch?: CtxTwitchExtension;
  chat?: CtxChatExtension;
  platform?: {
    alerts?: CtxPlatformAlertsExtension;
    chat?: CtxPlatformChatExtension;
  };
}

/**
 * The `ctx` object passed to every function invocation. Combines the
 * built-in surface (event, user, events, storage, http, env, resources)
 * with any extension namespaces the host registered.
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
  events: CtxEvents;
  storage: CtxStorage;
  http: CtxHttp;
  env: CtxEnv;
  resources: CtxResources;
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
