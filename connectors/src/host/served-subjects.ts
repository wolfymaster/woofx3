import type { AdapterStatus, ServedSubject, Unavailable, UnavailableReason } from "./adapter";
import type { AdapterId } from "./adapter-ids";
import { errorMessage, type Logger } from "./deps";
import { type HostRequests, parsed, type RequestContext } from "./host-requests";
import type { LinkState } from "./link-readers";
import type { ScopedBus } from "./scoped-bus";
import type { StatusListener } from "./supervisor";

/** The slice of the supervisor that answering for an adapter needs. */
export interface AdapterStatusSource {
  status(id: AdapterId): AdapterStatus;
  link(id: AdapterId): LinkState | null;
  onStatusChange(listener: StatusListener): () => void;
  recordServedError(id: AdapterId): void;
}

export interface ServedSubjectsDeps {
  requests: HostRequests;
  /** The host's own scope: adapters never subscribe to the subjects they serve. */
  scope: ScopedBus;
  adapters: AdapterStatusSource;
  logger: Logger;
}

/** What a held request ends up doing once its adapter's state settles, or its budget runs out. */
type Settled = { kind: "handle" } | { kind: "unavailable"; reason: UnavailableReason };

/**
 * Answers every adapter's served subjects for the whole life of the process.
 * The host holds the subscription rather than the adapter, so there is never
 * a gap while one stops and another start subscribes, and a caller always
 * gets one reply:
 *
 * - connected: the adapter's handler answers.
 * - stopped or parked: `unavailableReply` at once.
 * - starting, degraded or stopping: held until the adapter connects (handler
 *   answers), settles stopped or parked (unavailable at once), or the
 *   subject's budget runs out (unavailable, `starting`).
 */
export class ServedSubjects {
  constructor(private readonly deps: ServedSubjectsDeps) {}

  /** Subscribes to every subject the adapter serves. A subject served twice fails startup. */
  async serveAll(id: AdapterId, served: readonly ServedSubject[]): Promise<void> {
    for (const subject of served) {
      await this.serve(id, subject);
    }
  }

  private async serve(id: AdapterId, served: ServedSubject): Promise<void> {
    await this.deps.requests.serveRequest<Uint8Array, never>(this.deps.scope, {
      subject: served.subject,
      budgetMs: served.budgetMs,
      replyMode: "raw",
      // The adapter's handler owns its wire format, including bad requests.
      parse: (raw) => parsed(raw),
      handle: (request, ctx) => this.answer(id, served, request, ctx),
      // Only reached if answering itself throws; handler errors are caught below.
      errorReply: () => served.unavailableReply(this.unavailable(id, "stopped")),
    });
  }

  private async answer(
    id: AdapterId,
    served: ServedSubject,
    request: Uint8Array,
    ctx: RequestContext
  ): Promise<Uint8Array> {
    const settled = await this.settle(id, ctx.signal);
    if (settled.kind === "unavailable") {
      return served.unavailableReply(this.unavailable(id, settled.reason));
    }
    try {
      return await served.handle(request, { deadline: ctx.deadline, signal: ctx.signal });
    } catch (error) {
      this.deps.adapters.recordServedError(id);
      this.deps.logger.error("served subject handler failed", {
        adapter: id,
        subject: served.subject,
        error: errorMessage(error),
      });
      return served.unavailableReply(this.unavailable(id, "stopped"));
    }
  }

  /** Resolves at once for a settled state; otherwise on the next settled state or when `signal` aborts. */
  private settle(id: AdapterId, signal: AbortSignal): Promise<Settled> {
    const now = settledFor(this.deps.adapters.status(id));
    if (now !== undefined) {
      return Promise.resolve(now);
    }
    return new Promise<Settled>((resolve) => {
      const finish = (outcome: Settled) => {
        unsubscribe();
        signal.removeEventListener("abort", onAbort);
        resolve(outcome);
      };
      const onAbort = () => finish({ kind: "unavailable", reason: "starting" });
      const unsubscribe = this.deps.adapters.onStatusChange((changed, status) => {
        if (changed !== id) {
          return;
        }
        const outcome = settledFor(status);
        if (outcome !== undefined) {
          finish(outcome);
        }
      });
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private unavailable(id: AdapterId, reason: UnavailableReason): Unavailable {
    return { reason, link: this.deps.adapters.link(id) };
  }
}

/** Undefined while the adapter is on its way somewhere: a request waits for it to arrive. */
function settledFor(status: AdapterStatus): Settled | undefined {
  switch (status.state) {
    case "connected":
      return { kind: "handle" };
    case "stopped":
      return { kind: "unavailable", reason: "stopped" };
    case "parked":
      return { kind: "unavailable", reason: "parked" };
    case "starting":
    case "degraded":
    case "stopping":
      return undefined;
  }
}
