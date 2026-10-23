import {
  OBS_BROWSER_SOURCE_REFRESH_SUBJECT,
  OBS_STATUS_SUBJECT,
  type ObsBrowserSourceRefreshReply,
  EventType as ObsCommandType,
  type ObsControlReply,
  type ObsOptionsReply,
  parseObsBrowserSourceRefresh,
} from "@woofx3/common/cloudevents/Obs/commands";
import { OBS_SERVED_BUDGETS_MS, type ObsConfig } from "../../config/obs";
import type {
  Adapter,
  AdapterContext,
  AdapterManifest,
  AdapterModule,
  ServedRequestContext,
  ServedSubject,
  Unavailable,
} from "../../host/adapter";
import type { Logger, RandomSource, Timers } from "../../host/deps";
import type { LinkState } from "../../host/link-readers";
import { handleObsControlRequest } from "./control";
import { handleObsOptionsRequest } from "./options";
import { RefreshLatch } from "./refresh-latch";
import { createObsService, type ObsService } from "./service";
import { OBS_ENDPOINT, obsAdapterFallback } from "./settings";
import type { ObsStatusReply } from "./status";

/** Why the host is answering for a stopped OBS adapter, in words a streamer can act on. */
const UNAVAILABLE_MESSAGES: Record<Unavailable["reason"], string> = {
  stopped: "OBS is turned off in this engine",
  parked: "OBS is turned off in this engine",
  starting: "OBS is starting",
};

/**
 * The refresh request's answer when the host could not hand it to the latch
 * in time. sceneManager retries anything but an acceptance.
 */
const REFRESH_NOT_TAKEN = "the OBS adapter could not take the request in time";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

/** The `engine.obs.status` reply while the adapter cannot answer: nothing is trying to reach OBS. */
export function obsStatusUnavailableReply(): Uint8Array {
  return json({ state: "stopped", failure: null, address: null } satisfies ObsStatusReply);
}

/**
 * Answers `engine.obs.browser_source.refresh` whatever the adapter's state:
 * latches a valid request in the host state and accepts it, idempotently per
 * boot id. The running adapter, or the next one to start, acts on it.
 */
export function answerRefreshRequest(request: Uint8Array, latch: RefreshLatch): Uint8Array {
  let body: unknown;
  try {
    body = JSON.parse(decoder.decode(request));
  } catch {
    return json({ status: "invalid", error: "the request is not JSON" } satisfies ObsBrowserSourceRefreshReply);
  }
  const parsed = parseObsBrowserSourceRefresh(body);
  if (!parsed.ok) {
    return json({ status: "invalid", error: parsed.error } satisfies ObsBrowserSourceRefreshReply);
  }
  latch.latch(parsed.value);
  return json({ status: "accepted", bootId: parsed.value.bootId } satisfies ObsBrowserSourceRefreshReply);
}

export interface ObsAdapterDeps {
  config: ObsConfig;
  /** Jitter for the connection's retry backoff. */
  random: RandomSource;
  /** The connection's retry and open-deadline timers. */
  timers: Timers;
}

/** One run of the adapter: the OBS service it started, the logger it was given and the command timeout. */
interface ObsRun {
  service: ObsService;
  logger: Logger;
  commandTimeoutMs: number;
}

/**
 * OBS as a host adapter: keeps one obs-websocket session open, reached
 * directly or through the companion, and answers the engine's OBS requests
 * through the host. It runs while a module that controls OBS is installed
 * and active, or WOOFX3_OBS_HOST is set (adapters/obs/link.ts). While it
 * runs, OBS being closed is the connection's to retry, not a reason to stop.
 * Each start builds a fresh OBS service; the overlay refresh latch lives in
 * the host state and outlives every run, so a refresh requested while the
 * adapter is stopped is carried out when it next starts.
 */
export class ObsAdapter implements Adapter<RefreshLatch> {
  readonly manifest: AdapterManifest<RefreshLatch>;
  private run: ObsRun | undefined;

  constructor(
    private readonly deps: ObsAdapterDeps,
    private readonly latch: RefreshLatch
  ) {
    this.manifest = {
      id: "obs",
      publishes: [],
      subscribes: [],
      requests: [],
      localEndpoints: [OBS_ENDPOINT],
      serves: [
        this.served(
          ObsCommandType.ObsCommand,
          OBS_SERVED_BUDGETS_MS.command,
          (run, request) => answerCommand(run, request),
          (error) => json({ ok: false, error } satisfies ObsControlReply)
        ),
        this.served(
          ObsCommandType.ObsOptions,
          OBS_SERVED_BUDGETS_MS.options,
          (run, request) => answerOptions(run, request),
          (error) => json({ error } satisfies ObsOptionsReply)
        ),
        {
          subject: OBS_STATUS_SUBJECT,
          budgetMs: OBS_SERVED_BUDGETS_MS.status,
          handle: async () => {
            const run = this.run;
            return run === undefined ? obsStatusUnavailableReply() : json(run.service.status());
          },
          unavailableReply: () => obsStatusUnavailableReply(),
        },
        {
          subject: OBS_BROWSER_SOURCE_REFRESH_SUBJECT,
          budgetMs: OBS_SERVED_BUDGETS_MS.refresh,
          availability: "always",
          handle: async (request, ctx: ServedRequestContext<RefreshLatch>) =>
            answerRefreshRequest(request, ctx.hostState),
          unavailableReply: () =>
            json({ status: "unavailable", error: REFRESH_NOT_TAKEN } satisfies ObsBrowserSourceRefreshReply),
        },
      ],
    };
  }

  desired(link: LinkState): boolean {
    return link.connected && link.enabled;
  }

  /**
   * Starts the OBS connection and resolves at once, without waiting for OBS:
   * a request while OBS is closed reaches the handler and is answered with
   * "OBS is not connected (retrying)" straight away. The host's start signal
   * stays live for the whole run; once it aborts, the connection dials no
   * more and schedules nothing.
   */
  async start(ctx: AdapterContext, signal: AbortSignal): Promise<void> {
    if (this.run !== undefined) {
      throw new Error("the obs adapter is already running; the host never starts it twice");
    }
    signal.throwIfAborted();
    const fallback = obsAdapterFallback(this.deps.config.fallback);
    const service = createObsService({
      resolve: (attempt) => ctx.companion.resolve(OBS_ENDPOINT, { signal: attempt, fallback }),
      watchRoute: (listener) => ctx.companion.onRouteChange(OBS_ENDPOINT, listener),
      latch: this.latch,
      connection: this.deps.config.connection,
      random: this.deps.random,
      timers: this.deps.timers,
      logger: ctx.logger,
    });
    const run: ObsRun = { service, logger: ctx.logger, commandTimeoutMs: this.deps.config.commandTimeoutMs };
    signal.throwIfAborted();
    this.run = run;
    service.start(signal);
  }

  async stop(): Promise<void> {
    const run = this.run;
    this.run = undefined;
    await run?.service.stop();
  }

  detail(): Record<string, unknown> {
    const status = this.run?.service.status();
    if (status === undefined) {
      return { state: "stopped", route: null, address: null };
    }
    return { state: status.state, failure: status.failure, route: status.route ?? null, address: status.address };
  }

  private served(
    subject: string,
    budgetMs: number,
    answer: (run: ObsRun, request: Uint8Array) => Promise<Uint8Array>,
    unavailable: (message: string) => Uint8Array
  ): ServedSubject<RefreshLatch> {
    return {
      subject,
      budgetMs,
      handle: (request) => {
        // stop() can clear the run between the host's availability check and
        // this call; that is an ordinary stop, answered like one.
        const run = this.run;
        return run === undefined ? Promise.resolve(unavailable(UNAVAILABLE_MESSAGES.stopped)) : answer(run, request);
      },
      unavailableReply: ({ reason }) => unavailable(UNAVAILABLE_MESSAGES[reason]),
    };
  }
}

async function answerCommand(run: ObsRun, request: Uint8Array): Promise<Uint8Array> {
  const { connection } = run.service;
  const reply = await handleObsControlRequest(connection.current(), request, run.logger, {
    timeoutMs: run.commandTimeoutMs,
    onTimeout: () => connection.recycle("an OBS request timed out"),
  });
  return json(reply);
}

async function answerOptions(run: ObsRun, request: Uint8Array): Promise<Uint8Array> {
  const { connection } = run.service;
  const reply = await handleObsOptionsRequest(connection.current(), request, run.logger, {
    timeoutMs: run.commandTimeoutMs,
    onTimeout: () => connection.recycle("an OBS request timed out"),
  });
  return json(reply);
}

/** The registry entry's module: the refresh latch is its host state, one adapter for the life of the process. */
export function obsAdapterModule(deps: ObsAdapterDeps): AdapterModule<RefreshLatch> {
  return {
    hostState: () => new RefreshLatch(),
    create: (latch) => new ObsAdapter(deps, latch),
  };
}
