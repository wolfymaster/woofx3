// The websocket sessions the companion gateway holds for module requests. A
// module function runs for a few seconds at most, so it can never hold a
// socket itself: the gateway opens one per endpoint on first use, keeps it
// while it is used, and closes it when idle, when its route moves, or on
// shutdown. Every open gets a new session epoch, so module code can tell a
// silent reopen and authenticate again with a device that expects it once
// per connection.

import type {
  ModuleEndpointFailureCode,
  ModuleEndpointMatch,
} from "@woofx3/common/cloudevents/Companion/module-request";
import type { ModuleSessionLimits } from "../config/companion";
import { type Clock, errorMessage, type IdSource, type Logger, type TimerHandle, type Timers } from "../host/deps";
import { endpointKey } from "./claims";
import type {
  EndpointResolution,
  EndpointRoute,
  EndpointUnavailableReason,
  LocalEndpointRef,
  RouteChangeListener,
} from "./types";

/** Opens a client websocket to `url`, with no subprotocol. The url may carry a bridge ticket: never log it. */
export type OpenSocket = (url: string) => WebSocket;

export interface SessionFailure {
  ok: false;
  code: ModuleEndpointFailureCode;
  message: string;
  /** Set when the failure happened on an open session. */
  sessionEpoch?: string;
}

export type Acquired = { ok: true; session: EndpointSession } | SessionFailure;
export type SendOutcome = { ok: true; sessionEpoch: string } | SessionFailure;
export type RequestOutcome = { ok: true; reply: string; sessionEpoch: string } | SessionFailure;

/** Why a session was closed. */
export type SessionCloseCause = "idle" | "route_change" | "remote" | "stopped";

/** Inbound frames that resolved no request. */
export interface FrameCounters {
  /** Larger than maxMessageBytes; dropped unread. */
  oversized: number;
  /** Binary frames; module requests carry text only. */
  binary: number;
  /** Text frames that matched no pending request. */
  unmatched: number;
}

export interface ModuleSessionStatus {
  moduleId: string;
  endpointId: string;
  route: EndpointRoute;
  /** `host:port`, or the bridge's host through the companion. */
  address: string;
  sessionEpoch: string;
  /** Clock ms. */
  openedAt: number;
  pending: number;
}

export interface ModuleSessionsStatus {
  sessions: ModuleSessionStatus[];
  opening: number;
  limit: number;
  /** Sessions opened since startup. */
  opens: number;
  /** Opens that failed, and acquires refused at the session cap, by the code their callers got. */
  openFailures: Partial<Record<ModuleEndpointFailureCode, number>>;
  closes: Record<SessionCloseCause, number>;
  frames: FrameCounters;
}

/** How an endpoint failure reads to module code. The bridge's own failures are just `unavailable` there. */
const FAILURE_CODES: Record<EndpointUnavailableReason, ModuleEndpointFailureCode> = {
  not_declared: "not_declared",
  adapter_owned: "adapter_owned",
  protocol_unsupported: "protocol_unsupported",
  not_routed: "not_routed",
  address_refused: "address_refused",
  store_unreadable: "store_unreadable",
  busy: "busy",
  relay: "unavailable",
};

export function failureCodeFor(reason: EndpointUnavailableReason): ModuleEndpointFailureCode {
  return FAILURE_CODES[reason];
}

export interface EndpointSessionsDeps {
  limits: ModuleSessionLimits;
  /** One connect attempt's route under the module policy. Rejects only when `signal` aborts. */
  resolve(ref: LocalEndpointRef, signal: AbortSignal): Promise<EndpointResolution>;
  /** Calls `listener` when the endpoint's route may have moved. Returns the unsubscribe. */
  onRouteChange(ref: LocalEndpointRef, listener: RouteChangeListener): () => void;
  openSocket: OpenSocket;
  clock: Clock;
  timers: Timers;
  ids: IdSource;
  logger: Logger;
}

/** One endpoint's place in the pool, from the start of its open until it is dropped. */
interface Slot {
  ref: LocalEndpointRef;
  key: string;
  /** Aborted when the slot is dropped, abandoning an open in flight. */
  controller: AbortController;
  opening: Promise<Acquired>;
  session: EndpointSession | null;
  unwatch: () => void;
  idleTimer: TimerHandle | null;
}

export class EndpointSessions {
  private readonly slots = new Map<string, Slot>();
  private readonly frames: FrameCounters = { oversized: 0, binary: 0, unmatched: 0 };
  private readonly closes: Record<SessionCloseCause, number> = { idle: 0, route_change: 0, remote: 0, stopped: 0 };
  private readonly openFailures: Partial<Record<ModuleEndpointFailureCode, number>> = {};
  private opens = 0;
  private stopped = false;

  constructor(private readonly deps: EndpointSessionsDeps) {
    const { limits } = deps;
    for (const [name, value] of Object.entries(limits)) {
      if (!(Number.isInteger(value) && value > 0)) {
        throw new Error(`EndpointSessions: ${name} must be a whole number above 0, got ${value}`);
      }
    }
  }

  /**
   * The endpoint's open session, opening one if there is none. A call whose
   * `signal` aborts while the open is still running gets `unavailable`, and
   * the open carries on to its own timeout so the next call finds it.
   */
  async acquire(ref: LocalEndpointRef, signal: AbortSignal): Promise<Acquired> {
    if (this.stopped) {
      return failure("unavailable", "the companion gateway is stopping");
    }
    const key = endpointKey(ref);
    let slot = this.slots.get(key);
    if (slot === undefined) {
      if (this.slots.size >= this.deps.limits.maxSessions) {
        this.countOpenFailure("busy");
        return failure(
          "busy",
          `too many local endpoint sessions open (${this.deps.limits.maxSessions}); try again later`
        );
      }
      slot = this.open(ref, key);
    }
    if (slot.session !== null) {
      this.touch(slot);
      return { ok: true, session: slot.session };
    }
    const outcome = await untilAborted(slot.opening, signal);
    if (outcome === null) {
      return failure("unavailable", `${key} is still connecting; try again shortly`);
    }
    if (outcome.ok) {
      this.touch(slot);
    }
    return outcome;
  }

  status(): ModuleSessionsStatus {
    const sessions: ModuleSessionStatus[] = [];
    let opening = 0;
    for (const { ref, session } of this.slots.values()) {
      if (session === null) {
        opening++;
        continue;
      }
      sessions.push({
        moduleId: ref.moduleId,
        endpointId: ref.endpointId,
        route: session.route,
        address: session.address,
        sessionEpoch: session.epoch,
        openedAt: session.openedAt,
        pending: session.pending,
      });
    }
    return {
      sessions,
      opening,
      limit: this.deps.limits.maxSessions,
      opens: this.opens,
      openFailures: { ...this.openFailures },
      closes: { ...this.closes },
      frames: { ...this.frames },
    };
  }

  /** Closes every session and abandons every open; pending requests are answered `unavailable`. */
  async stop(): Promise<void> {
    this.stopped = true;
    const openings = [...this.slots.values()].map((slot) => slot.opening);
    for (const slot of [...this.slots.values()]) {
      this.drop(slot, "stopped", "the companion gateway stopped");
    }
    await Promise.all(openings);
  }

  private open(ref: LocalEndpointRef, key: string): Slot {
    const slot: Slot = {
      ref,
      key,
      controller: new AbortController(),
      // Replaced below, once the slot exists for the open to read.
      opening: Promise.resolve(failure("unavailable", "not opened")),
      session: null,
      unwatch: () => {},
      idleTimer: null,
    };
    this.slots.set(key, slot);
    // Watched from the start: a route that moves while the open runs may have
    // been read before the move.
    slot.unwatch = this.deps.onRouteChange(ref, (why) => {
      this.drop(slot, "route_change", why);
    });
    slot.opening = this.connect(slot);
    return slot;
  }

  private async connect(slot: Slot): Promise<Acquired> {
    const { limits, timers } = this.deps;
    const { signal } = slot.controller;
    const timer = timers.setTimeout(() => {
      slot.controller.abort(new Error(`${slot.key} did not open within ${limits.openTimeoutMs}ms`));
    }, limits.openTimeoutMs);
    try {
      let resolution: EndpointResolution;
      try {
        resolution = await this.deps.resolve(slot.ref, signal);
      } catch (error) {
        return this.openFailed(slot, "unavailable", errorMessage(signal.aborted ? signal.reason : error));
      }
      if (!resolution.ok) {
        return this.openFailed(slot, failureCodeFor(resolution.reason), resolution.message);
      }
      if (signal.aborted) {
        return this.openFailed(slot, "unavailable", errorMessage(signal.reason));
      }
      let socket: WebSocket;
      try {
        socket = this.deps.openSocket(resolution.url);
      } catch (error) {
        return this.openFailed(slot, "unavailable", `${slot.key} (${resolution.address}): ${errorMessage(error)}`);
      }
      const refused = await socketOpened(socket, signal);
      if (refused !== null) {
        return this.openFailed(slot, "unavailable", `${slot.key} (${resolution.address}): ${refused}`);
      }
      // Dropped in the moment between the upgrade and here: nobody may use this socket.
      if (signal.aborted) {
        socket.close(1000);
        return this.openFailed(slot, "unavailable", errorMessage(signal.reason));
      }
      const session = new EndpointSession({
        socket,
        epoch: this.deps.ids.next(),
        route: resolution.route,
        address: resolution.address,
        openedAt: this.deps.clock.now(),
        maxPending: limits.maxPendingPerSession,
        maxMessageBytes: limits.maxMessageBytes,
        frames: this.frames,
        onRemoteClose: (why) => {
          this.drop(slot, "remote", why);
        },
      });
      slot.session = session;
      // Started here, not only on use: an open that outlives every waiting
      // caller still has to close once idle and give up its slot.
      this.touch(slot);
      this.opens++;
      this.deps.logger.info("local endpoint session opened", {
        moduleId: slot.ref.moduleId,
        endpointId: slot.ref.endpointId,
        route: session.route,
        address: session.address,
        sessionEpoch: session.epoch,
      });
      return { ok: true, session };
    } finally {
      timers.clearTimeout(timer);
    }
  }

  private openFailed(slot: Slot, code: ModuleEndpointFailureCode, message: string): SessionFailure {
    if (this.slots.get(slot.key) === slot) {
      this.slots.delete(slot.key);
      slot.unwatch();
    }
    this.countOpenFailure(code);
    this.deps.logger.warn("local endpoint session did not open", {
      moduleId: slot.ref.moduleId,
      endpointId: slot.ref.endpointId,
      code,
      error: message,
    });
    return failure(code, message);
  }

  /**
   * Restarts the idle clock. A session with requests still pending is never
   * idle. A slot already dropped gets no timer, since nothing would clear it.
   */
  private touch(slot: Slot): void {
    const { timers, limits } = this.deps;
    if (this.slots.get(slot.key) !== slot) {
      return;
    }
    if (slot.idleTimer !== null) {
      timers.clearTimeout(slot.idleTimer);
    }
    slot.idleTimer = timers.setTimeout(() => {
      slot.idleTimer = null;
      if ((slot.session?.pending ?? 0) > 0) {
        this.touch(slot);
        return;
      }
      this.drop(slot, "idle", `unused for ${limits.idleMs}ms`);
    }, limits.idleMs);
  }

  /** Removes the slot, abandoning its open or closing its session. Dropping a slot twice is harmless. */
  private drop(slot: Slot, cause: SessionCloseCause, why: string): void {
    if (this.slots.get(slot.key) !== slot) {
      return;
    }
    this.slots.delete(slot.key);
    slot.unwatch();
    if (slot.idleTimer !== null) {
      this.deps.timers.clearTimeout(slot.idleTimer);
      slot.idleTimer = null;
    }
    slot.controller.abort(new Error(why));
    if (slot.session === null) {
      return;
    }
    this.closes[cause]++;
    slot.session.close(why);
    this.deps.logger.info("local endpoint session closed", {
      moduleId: slot.ref.moduleId,
      endpointId: slot.ref.endpointId,
      cause,
      why,
      sessionEpoch: slot.session.epoch,
    });
  }

  private countOpenFailure(code: ModuleEndpointFailureCode): void {
    this.openFailures[code] = (this.openFailures[code] ?? 0) + 1;
  }
}

interface EndpointSessionInit {
  socket: WebSocket;
  epoch: string;
  route: EndpointRoute;
  address: string;
  openedAt: number;
  maxPending: number;
  maxMessageBytes: number;
  frames: FrameCounters;
  onRemoteClose(why: string): void;
}

interface Waiter {
  match: ModuleEndpointMatch;
  finish(outcome: RequestOutcome): void;
}

/** One open websocket to an endpoint. */
export class EndpointSession {
  readonly epoch: string;
  readonly route: EndpointRoute;
  readonly address: string;
  readonly openedAt: number;
  private readonly waiters = new Map<string, Waiter>();
  private closedBecause: string | null = null;

  constructor(private readonly init: EndpointSessionInit) {
    this.epoch = init.epoch;
    this.route = init.route;
    this.address = init.address;
    this.openedAt = init.openedAt;
    init.socket.addEventListener("message", (event) => {
      this.inbound(event.data);
    });
    init.socket.addEventListener("close", (event) => {
      if (this.closedBecause === null) {
        const why = `the endpoint closed the connection (${event.code})`;
        this.close(why);
        init.onRemoteClose(why);
      }
    });
  }

  get pending(): number {
    return this.waiters.size;
  }

  /** Writes one text frame, unless `signal` has already aborted. */
  send(message: string, signal: AbortSignal): SendOutcome {
    const refused = this.writable(message, signal);
    if (refused !== null) {
      return refused;
    }
    return this.write(message) ?? { ok: true, sessionEpoch: this.epoch };
  }

  /**
   * Writes one text frame and answers with the first inbound JSON object
   * whose top-level `match.field` is `match.value`. One pending request per
   * match on a session, so concurrent callers never take each other's replies.
   */
  request(match: ModuleEndpointMatch, message: string, signal: AbortSignal): Promise<RequestOutcome> {
    const refused = this.writable(message, signal);
    if (refused !== null) {
      return Promise.resolve(refused);
    }
    const key = matchKey(match);
    if (this.waiters.has(key)) {
      return Promise.resolve(
        this.failed("busy", `a request matching ${match.field}=${JSON.stringify(match.value)} is already pending`)
      );
    }
    if (this.waiters.size >= this.init.maxPending) {
      return Promise.resolve(
        this.failed("busy", `too many requests pending on this session (${this.init.maxPending})`)
      );
    }
    return new Promise<RequestOutcome>((resolve) => {
      const onAbort = () => {
        finish(this.failed("timeout", "no matching reply arrived before the budget ran out"));
      };
      const finish = (outcome: RequestOutcome) => {
        if (this.waiters.get(key)?.finish === finish) {
          this.waiters.delete(key);
          signal.removeEventListener("abort", onAbort);
          resolve(outcome);
        }
      };
      // Registered before the write, so a reply that arrives at once is not missed.
      this.waiters.set(key, { match, finish });
      signal.addEventListener("abort", onAbort, { once: true });
      const failedWrite = this.write(message);
      if (failedWrite !== null) {
        finish(failedWrite);
      }
    });
  }

  /** Closes the socket and answers every pending request `unavailable`. */
  close(why: string): void {
    if (this.closedBecause !== null) {
      return;
    }
    this.closedBecause = why;
    for (const waiter of [...this.waiters.values()]) {
      waiter.finish(this.failed("unavailable", `the session closed: ${why}`));
    }
    if (this.init.socket.readyState === WebSocket.OPEN || this.init.socket.readyState === WebSocket.CONNECTING) {
      this.init.socket.close(1000);
    }
  }

  private writable(message: string, signal: AbortSignal): SessionFailure | null {
    if (signal.aborted) {
      return this.failed("timeout", "the budget ran out before the frame was written");
    }
    if (this.closedBecause !== null || this.init.socket.readyState !== WebSocket.OPEN) {
      return this.failed("unavailable", `the session closed: ${this.closedBecause ?? "not open"}`);
    }
    if (Buffer.byteLength(message, "utf8") > this.init.maxMessageBytes) {
      return this.failed("invalid", `the message is larger than ${this.init.maxMessageBytes} bytes`);
    }
    return null;
  }

  private write(message: string): SessionFailure | null {
    try {
      this.init.socket.send(message);
      return null;
    } catch (error) {
      return this.failed("unavailable", `the frame could not be written: ${errorMessage(error)}`);
    }
  }

  private inbound(data: unknown): void {
    const { frames } = this.init;
    if (typeof data !== "string") {
      frames.binary++;
      return;
    }
    if (Buffer.byteLength(data, "utf8") > this.init.maxMessageBytes) {
      frames.oversized++;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      // A frame that is not JSON can answer no request; it is counted, not an error.
      frames.unmatched++;
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      frames.unmatched++;
      return;
    }
    const fields = parsed as Record<string, unknown>;
    let matched = false;
    for (const waiter of [...this.waiters.values()]) {
      const { field, value } = waiter.match;
      if (Object.hasOwn(fields, field) && fields[field] === value) {
        matched = true;
        waiter.finish({ ok: true, reply: data, sessionEpoch: this.epoch });
      }
    }
    if (!matched) {
      frames.unmatched++;
    }
  }

  private failed(code: ModuleEndpointFailureCode, message: string): SessionFailure {
    return { ok: false, code, message, sessionEpoch: this.epoch };
  }
}

/** One key per match. The value's type is part of it: the string "1" never matches the number 1. */
function matchKey(match: ModuleEndpointMatch): string {
  return JSON.stringify([match.field, match.value]);
}

function failure(code: ModuleEndpointFailureCode, message: string): SessionFailure {
  return { ok: false, code, message };
}

/** Null once the socket is open, or why it never opened. Aborting `signal` closes it. */
function socketOpened(socket: WebSocket, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    const listeners = new AbortController();
    const done = (outcome: string | null) => {
      listeners.abort();
      resolve(outcome);
    };
    const options = { signal: listeners.signal };
    socket.addEventListener("open", () => done(null), options);
    // The error event says nothing useful, and its target's url may carry a ticket.
    socket.addEventListener("error", () => done("the connection failed"), options);
    socket.addEventListener("close", (event) => done(`the endpoint refused the connection (${event.code})`), options);
    signal.addEventListener(
      "abort",
      () => {
        socket.close();
        done(errorMessage(signal.reason));
      },
      options
    );
    if (signal.aborted) {
      socket.close();
      done(errorMessage(signal.reason));
    }
  });
}

/** `work`'s value, or null as soon as `signal` aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) {
    return Promise.resolve(null);
  }
  return new Promise<T | null>((resolve) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve(null);
      }
    );
  });
}
