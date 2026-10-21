// Fakes shared by the host's tests: a hand-driven clock and timers, a bus,
// a recording logger and a scriptable adapter. Not imported by the host.
import type { Adapter, AdapterContext, AdapterManifest, ServedSubject } from "./adapter";
import type { AdapterId } from "./adapter-ids";
import type { Clock, IdSource, Logger, LogMetadata, RandomSource, TimerHandle, Timers } from "./deps";
import type { LinkState } from "./link-readers";
import { type BusClient, type BusHandler, type BusMessage, type BusSubscription, subjectCovered } from "./scoped-bus";

/** Lets every pending promise callback run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

interface FakeTimer {
  id: number;
  at: number;
  fn: () => void;
  everyMs: number | undefined;
}

/** A clock and timers that only move when a test calls `advance`. */
export class FakeTime implements Clock, Timers {
  private current: number;
  private nextId = 1;
  private readonly timers = new Map<number, FakeTimer>();

  constructor(start = 1_000_000) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    return this.add(fn, ms, undefined);
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as number);
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    return this.add(fn, ms, ms);
  }

  clearInterval(handle: TimerHandle): void {
    this.timers.delete(handle as number);
  }

  get pending(): number {
    return this.timers.size;
  }

  /** Moves the clock forward, firing each due timer in order and letting its work settle. */
  async advance(ms: number): Promise<void> {
    const until = this.current + ms;
    for (;;) {
      const due = [...this.timers.values()].filter((t) => t.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) {
        break;
      }
      this.current = due.at;
      if (due.everyMs === undefined) {
        this.timers.delete(due.id);
      } else {
        due.at += due.everyMs;
      }
      due.fn();
      await flush();
    }
    this.current = until;
    await flush();
  }

  private add(fn: () => void, ms: number, everyMs: number | undefined): number {
    const id = this.nextId++;
    this.timers.set(id, { id, at: this.current + ms, fn, everyMs });
    return id;
  }
}

export const halfRandom: RandomSource = { next: () => 0.5 };

export function countingIds(): IdSource {
  let n = 0;
  return { next: () => `id-${++n}` };
}

export interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata: LogMetadata | undefined;
}

export class RecordingLogger implements Logger {
  constructor(readonly entries: LogEntry[] = []) {}

  debug(message: string, metadata?: LogMetadata): void {
    this.entries.push({ level: "debug", message, metadata });
  }

  info(message: string, metadata?: LogMetadata): void {
    this.entries.push({ level: "info", message, metadata });
  }

  warn(message: string, metadata?: LogMetadata): void {
    this.entries.push({ level: "warn", message, metadata });
  }

  error(message: string, metadata?: LogMetadata): void {
    this.entries.push({ level: "error", message, metadata });
  }

  child(): Logger {
    return new RecordingLogger(this.entries);
  }

  at(level: LogEntry["level"]): LogEntry[] {
    return this.entries.filter((entry) => entry.level === level);
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function text(data: Uint8Array): string {
  return decoder.decode(data);
}

interface FakeSubscription {
  pattern: string;
  handler: BusHandler;
  active: boolean;
}

/** An in-memory bus. `deliver` hands a message to every matching subscription and collects replies. */
export class FakeBus implements BusClient {
  readonly published: Array<{ subject: string; data: Uint8Array }> = [];
  readonly subscriptions: FakeSubscription[] = [];
  failUnsubscribe = false;

  async publish(subject: string, data: Uint8Array): Promise<void> {
    this.published.push({ subject, data });
  }

  async subscribe(subject: string, handler: BusHandler): Promise<BusSubscription> {
    const subscription: FakeSubscription = { pattern: subject, handler, active: true };
    this.subscriptions.push(subscription);
    return {
      unsubscribe: () => {
        if (this.failUnsubscribe) {
          throw new Error(`unsubscribe from ${subject} failed`);
        }
        subscription.active = false;
      },
    };
  }

  async request(subject: string): Promise<{ subject: string; data: Uint8Array }> {
    throw new Error(`no responder on ${subject}`);
  }

  active(subject: string): number {
    return this.subscriptions.filter((s) => s.active && s.pattern === subject).length;
  }

  /** Delivers a message. With `reply` set, every respond() is collected into the returned list. */
  deliver(subject: string, data: Uint8Array, reply?: string): Uint8Array[] {
    const replies: Uint8Array[] = [];
    const msg: BusMessage = {
      subject,
      data,
      reply,
      respond: (out) => {
        if (reply === undefined) {
          return false;
        }
        replies.push(out);
        return true;
      },
    };
    for (const subscription of this.subscriptions) {
      if (subscription.active && subjectCovered(subscription.pattern, subject)) {
        void subscription.handler(msg);
      }
    }
    return replies;
  }
}

type Step = "resolve" | "reject" | "hang" | "ignoreAbort";

/**
 * An adapter whose start and stop do what the test scripts. `starts` and
 * `stops` count calls; `lastContext` is the context of the latest start.
 */
export class FakeAdapter implements Adapter {
  readonly manifest: AdapterManifest;
  starts = 0;
  stops = 0;
  running = 0;
  maxRunning = 0;
  startSteps: Step[] = [];
  defaultStart: Step = "resolve";
  stopStep: "resolve" | "hang" = "resolve";
  lastContext: AdapterContext | undefined;
  private release: (() => void) | undefined;

  constructor(id: AdapterId = "twitch", serves: ServedSubject[] = []) {
    this.manifest = { id, publishes: ["fake.out"], subscribes: ["fake.in"], requests: [], serves };
  }

  desired(link: LinkState): boolean {
    return link.connected && link.enabled;
  }

  start(ctx: AdapterContext, signal: AbortSignal): Promise<void> {
    this.starts++;
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    this.lastContext = ctx;
    const step = this.startSteps.shift() ?? this.defaultStart;
    const done = () => {
      this.running--;
    };
    switch (step) {
      case "resolve":
        done();
        return Promise.resolve();
      case "reject":
        done();
        return Promise.reject(new Error("could not connect"));
      case "hang":
        return new Promise<void>((resolve, reject) => {
          this.release = () => {
            done();
            resolve();
          };
          signal.addEventListener("abort", () => {
            done();
            reject(new Error("aborted"));
          });
        });
      case "ignoreAbort":
        return new Promise<void>((resolve) => {
          this.release = () => {
            done();
            resolve();
          };
        });
    }
  }

  /** Lets a hanging start finish connected. */
  finishStart(): void {
    const release = this.release;
    this.release = undefined;
    release?.();
  }

  stop(): Promise<void> {
    this.stops++;
    if (this.stopStep === "hang") {
      return new Promise<void>(() => {});
    }
    return Promise.resolve();
  }
}

export const linked: LinkState = { connected: true, enabled: true };
export const disabled: LinkState = { connected: true, enabled: false };
export const unlinked: LinkState = { connected: false, enabled: false };
