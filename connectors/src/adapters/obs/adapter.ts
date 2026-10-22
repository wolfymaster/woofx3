import {
  OBS_BROWSER_SOURCE_REFRESH_SUBJECT,
  OBS_STATUS_SUBJECT,
  type ObsBrowserSourceRefreshReply,
  EventType as ObsCommandType,
  type ObsControlReply,
  type ObsOptionsReply,
  parseObsBrowserSourceRefresh,
} from "@woofx3/common/cloudevents/Obs/commands";
import {
  RELAY_CONFIG_UPDATED_SUBJECT,
  RELAY_CREDENTIAL_SUBJECT,
  type RelayGrant,
  requestRelayCredentialOverNats,
} from "@woofx3/common/cloudevents/Relay/relay";
import type { EndpointStore } from "../../companion/endpoint-store";
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
import { errorMessage, type Logger } from "../../host/deps";
import type { LinkState } from "../../host/link-readers";
import type { BusMessage, ScopedBus } from "../../host/scoped-bus";
import type { DbProxyClientConfig } from "../../services/db-proxy";
import { handleObsControlRequest } from "./control";
import { handleObsOptionsRequest } from "./options";
import { RefreshLatch } from "./refresh-latch";
import { createObsService, type ObsService } from "./service";
import { OBS_MODULE_ID } from "./settings";
import type { ObsStatusReply } from "./status";

/** db-proxy announces every module setting write here, naming the module and key but never the value. */
export const MODULE_SETTING_UPDATED_SUBJECT = "db.module.setting.updated.*";

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
  /** Where OBS is when the OBS module's settings leave a value empty. */
  fallback: ObsConfig;
  /** Builds the store OBS's route is read from, over the host's db-proxy client. */
  endpointStore(db: DbProxyClientConfig): EndpointStore;
}

/** One run of the adapter: the OBS service it started and the logger it was given. */
interface ObsRun {
  service: ObsService;
  logger: Logger;
}

/**
 * OBS as a host adapter: keeps one obs-websocket session open, reached
 * directly or through the companion, and answers the engine's OBS requests
 * through the host. It always runs: OBS being closed is the connection's to
 * retry, not a reason to stop. Each start builds a fresh OBS service; the
 * overlay refresh latch lives in the host state and outlives every run.
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
      subscribes: [MODULE_SETTING_UPDATED_SUBJECT, RELAY_CONFIG_UPDATED_SUBJECT],
      requests: [RELAY_CREDENTIAL_SUBJECT],
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
   * "OBS is not connected (retrying)" straight away.
   */
  async start(ctx: AdapterContext): Promise<void> {
    if (this.run !== undefined) {
      throw new Error("the obs adapter is already running; the host never starts it twice");
    }
    const service = createObsService({
      store: this.deps.endpointStore(ctx.dbProxy),
      relayCredential: relayCredentialOver(ctx.bus),
      fallback: this.deps.fallback,
      latch: this.latch,
      logger: ctx.logger,
    });
    const run: ObsRun = { service, logger: ctx.logger };
    await ctx.bus.subscribe(MODULE_SETTING_UPDATED_SUBJECT, (msg) => {
      onModuleSettingUpdated(run, msg);
    });
    await ctx.bus.subscribe(RELAY_CONFIG_UPDATED_SUBJECT, () => onRelayConfigUpdated(run));
    this.run = run;
    service.start();
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
    onTimeout: () => connection.recycle("an OBS request timed out"),
  });
  return json(reply);
}

async function answerOptions(run: ObsRun, request: Uint8Array): Promise<Uint8Array> {
  const { connection } = run.service;
  const reply = await handleObsOptionsRequest(connection.current(), request, run.logger, {
    onTimeout: () => connection.recycle("an OBS request timed out"),
  });
  return json(reply);
}

/**
 * A change to the OBS module's settings reconnects with the new details:
 * the connection reads them afresh on every attempt.
 */
function onModuleSettingUpdated(run: ObsRun, msg: BusMessage): void {
  let moduleId: unknown;
  try {
    moduleId = (JSON.parse(decoder.decode(msg.data)) as { data?: { moduleId?: unknown } } | null)?.data?.moduleId;
  } catch (error) {
    run.logger.warn(`${msg.subject}: malformed JSON body; dropped`, { error: errorMessage(error) });
    return;
  }
  if (moduleId === OBS_MODULE_ID) {
    run.service.connection.reconnectNow("OBS module settings changed");
  }
}

/**
 * The api announces a change to which local endpoints go through the
 * companion. The open session is replaced only when the change moves OBS to
 * another route; a configuration that cannot be read is assumed to.
 */
async function onRelayConfigUpdated(run: ObsRun): Promise<void> {
  const moves = await run.service.relayConfigMovesObs().catch((error: unknown) => {
    run.logger.warn("relay config change: could not read where OBS is reached; reconnecting to be sure", {
      error: errorMessage(error),
    });
    return true;
  });
  if (moves) {
    run.service.connection.reconnectNow("Relay configuration changed");
  }
}

/** Asks the api for the bridge credential over the adapter's scoped bus. */
function relayCredentialOver(bus: Pick<ScopedBus, "request">): (force: boolean) => Promise<RelayGrant | null> {
  return requestRelayCredentialOverNats((subject, data, opts) => {
    if (opts?.timeout === undefined) {
      throw new Error(`${subject}: a request needs a timeout`);
    }
    return bus.request(subject, data, { timeout: opts.timeout });
  });
}

/** The registry entry's module: the refresh latch is its host state, one adapter for the life of the process. */
export function obsAdapterModule(deps: ObsAdapterDeps): AdapterModule<RefreshLatch> {
  return {
    hostState: () => new RefreshLatch(),
    create: (latch) => new ObsAdapter(deps, latch),
  };
}
