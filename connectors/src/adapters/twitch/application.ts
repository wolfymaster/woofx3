import type { ApiClient, HelixUser } from "@twurple/api";
import type { AuthProvider } from "@twurple/auth";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import { HELIX_COMMAND, TWITCHAPI_SUBJECT } from "@woofx3/common/cloudevents/Twitch/commands";
import { INTEGRATION_TOKEN_UPDATED_SUBJECT } from "@woofx3/common/integrations/integration-settings";
import { type Span, SpanKind, withSpan } from "@woofx3/common/logging";
import { ListModuleSettings } from "@woofx3/db/module_setting.pb";
import { GetSetting, SetSetting } from "@woofx3/db/setting.pb";
import TwitchClient, { requestTokenOverNats, type TwitchAuthProviderKind } from "@woofx3/twitch";
import type { TwitchConfig } from "../../config/twitch";
import { type Clock, errorMessage, type IdSource, type Logger } from "../../host/deps";
import type { BusMessage, ScopedBus } from "../../host/scoped-bus";
import type { DbProxyClientConfig } from "../../services/db-proxy";
import { TWITCH_EVENT_SOURCE } from "./event-source";
import { AdBreakScheduler } from "./lib/adBreakScheduler";
import { AdBreakLeadSetting } from "./lib/adBreakSettings";
import { ChatterMembershipEnricher, DEFAULT_ENRICHER_OPTIONS, TwurpleMembershipLookup } from "./lib/chatterMembership";
import { HELIX_DEADLINE_MS } from "./lib/helix";
import { type PublishTarget, publishEvent } from "./lib/publishEvent";
import type { SelfSentRegistry } from "./lib/self-sent";
import { enqueueShoutoutOverNats } from "./lib/shoutoutQueue";
import type TwitchApiClient from "./lib/twitch";
import TwitchApiClientImpl, {
  isTwitchApiCommand,
  type TwitchApiCall,
  type TwitchApiReplyCode,
  twitchApiErrorCodeOf,
} from "./lib/twitch";
import TwitchEventBus from "./lib/twitchEventBus";
import type { EventPublisher } from "./types";

/**
 * Inbound request on the `twitchapi` subject: `{ command, args? }`.
 */
interface TwitchApiRequest {
  command: string;
  args?: Record<string, unknown>;
}

/**
 * The request carried by a `twitchapi` message. Two senders shape it
 * differently and both are served: the api wraps it in a CloudEvent
 * (`{ type, source, time, data: { command, args } }`), while the sandbox's
 * `ctx.twitch` and the chatbot's built-in commands send the bare
 * `{ command, args }`.
 */
export function parseTwitchApiRequest(body: unknown): TwitchApiRequest | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as { command?: unknown; data?: unknown };
  if (typeof record.command === "string") {
    return record as TwitchApiRequest;
  }
  if (record.data && typeof record.data === "object") {
    return record.data as TwitchApiRequest;
  }
  return null;
}

/**
 * The error name TwitchClient.init rejects with while no Twitch account is
 * linked. Must match TWITCH_NOT_LINKED in shared/clients/typescript/twitch;
 * not imported, because tests replace that module with a default-only mock.
 */
const TWITCH_NOT_LINKED = "TwitchNotLinked";

/** Whether `err` is TwitchClient's refusal for a missing or blank stored token. */
function isNotLinked(err: unknown): boolean {
  return err instanceof Error && err.name === TWITCH_NOT_LINKED;
}

/** The CloudEvent type of every `twitchapi` refusal. Must match ERROR_REPLY_TYPE in barkloader's twitch extension. */
export const TWITCHAPI_ERROR_TYPE = "twitchapi.error";

/** The slice of the adapter's scoped bus the twitch application uses. */
export type TwitchBus = Pick<ScopedBus, "publish" | "subscribe" | "request">;

/** What one start of the twitch application runs with, and what it builds while connected. */
export type TwitchAppContext = {
  logger: Logger;
  bus: TwitchBus;
  db: DbProxyClientConfig;
  config: TwitchConfig;
  /** Tells the host this run lost Twitch, so it restarts the adapter with backoff (see AdapterContext). */
  reportFault(reason: string): void;
  /** Absent until connected. */
  broadcaster?: HelixUser;
  twitchEventBus?: TwitchEventBus;
  /** Absent until connected. */
  twitchApi?: TwitchApiClient;
};

/** Stamps `twitchapi` replies. */
export interface TwitchReplyDeps {
  clock: Clock;
  ids: IdSource;
}

export interface TwitchApplicationDeps extends TwitchReplyDeps {
  /**
   * The engine's own chat lines awaiting their echo. Outlives the run, so a
   * line said just before a restart is still known when it comes back.
   */
  selfSent: SelfSentRegistry;
}

/** How a connect attempt ended. `not_linked`: no Twitch token is stored. */
export type ConnectOutcome = "connected" | "not_linked";

/**
 * What one connect builds, filled in as it goes, so a connect that fails or
 * is aborted part-way can close exactly what it got to.
 */
interface Connection {
  client: TwitchClient;
  adBreakScheduler?: AdBreakScheduler;
  eventBus?: TwitchEventBus;
  /**
   * Set once closed by stop, a failed connect or a reconnecting relink, so a
   * late renewal failure from it is ignored. An in-place token swap keeps the
   * connection open and may still see one late fault from the old token; the
   * restart it causes recovers on its own.
   */
  closed: boolean;
}

/** The parts of a finished connect the rest of the run reads. */
interface Connected {
  apiClient: ApiClient;
  broadcaster: HelixUser;
  twitchApi: TwitchApiClient;
  adBreakScheduler: AdBreakScheduler;
}

/** Stops everything a connection built, however far its connect got. */
async function closeConnection(connection: Connection): Promise<void> {
  connection.closed = true;
  try {
    connection.eventBus?.disconnect();
  } finally {
    try {
      connection.adBreakScheduler?.stop();
    } finally {
      await connection.client.close();
    }
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Twitch for one adapter run: EventSub to bus events, and the `twitchapi`
 * commands. The adapter builds one per start and stops it on stop.
 */
export default class TwitchApplication {
  constructor(private readonly deps: TwitchApplicationDeps) {}

  /**
   * "waiting" while no Twitch account is linked, then "connected". The
   * adapter only starts once a token is stored, so waiting is brief: a race
   * with an unlink, or a relink that arrives mid-connect.
   */
  private link: "waiting" | "connecting" | "connected" = "waiting";
  private connection: Connection | null = null;
  /** A token update arrived mid-connect; applied once the connect finishes. */
  private relinkPending = false;
  /**
   * Aborted when this run ends, by `stop` or by the adapter's start signal.
   * Every connect and relink gives up on it, so nothing connects after stop.
   */
  private readonly lifetime = new AbortController();
  /** Background work `stop` waits for: event publishes and the live-state read. */
  private readonly inFlight = new Set<Promise<unknown>>();

  private async onTokenUpdated(ctx: TwitchAppContext): Promise<void> {
    if (this.lifetime.signal.aborted) {
      ctx.logger.debug("twitch: ignoring a Twitch token update after stop");
      return;
    }
    switch (this.link) {
      case "waiting": {
        await this.connect(ctx);
        return;
      }
      case "connecting": {
        this.relinkPending = true;
        return;
      }
      case "connected": {
        await this.relink(ctx);
        return;
      }
    }
  }

  /**
   * Apply a relinked token while connected. Relinking is how a streamer
   * grants a scope the first link lacked, so the running auth provider has
   * to take the new token (it would otherwise keep refreshing the old one,
   * and its scopes), and every EventSub subscription is requested again so
   * one refused for a missing scope gets its retry.
   *
   * A relink to a different Twitch account changes the broadcaster, and one
   * to a token renewed another way (from the api service instead of with the
   * confidential app, or the reverse) needs a different auth provider.
   * Neither is covered by a token swap, so both reconnect from scratch.
   */
  private async relink(ctx: TwitchAppContext): Promise<void> {
    const connection = this.connection;
    const eventBus = connection?.eventBus;
    if (!connection || !eventBus) {
      return;
    }
    const signal = this.lifetime.signal;
    let reloaded: { userChanged: boolean; providerChanged: boolean };
    try {
      reloaded = await connection.client.reloadToken();
    } catch (err) {
      // An unlink clears the token and announces it like a relink. The host
      // stops this adapter once it reads the link, so the running
      // connection is left alone until then.
      if (isNotLinked(err)) {
        ctx.logger.debug("twitch: ignoring a Twitch token update that left no token stored");
        return;
      }
      throw err;
    }
    signal.throwIfAborted();
    const { userChanged, providerChanged } = reloaded;
    const broadcasterChanged = userChanged && ctx.config.channel === undefined;
    if (providerChanged || broadcasterChanged) {
      ctx.logger.info("twitch: Twitch was relinked with a token this connection cannot take; reconnecting", {
        providerChanged,
        broadcasterChanged,
      });
      this.link = "connecting";
      await this.dropConnection(ctx);
      await this.connect(ctx);
      return;
    }
    await eventBus.resubscribe(signal);
    signal.throwIfAborted();
    ctx.logger.info("twitch: relinked token applied", {
      established: eventBus.establishedCount(),
      expected: TwitchEventBus.expectedSubscriptionCount,
    });
  }

  /**
   * Listens for relinks, then connects. On `not_linked` nothing runs but that
   * listener, which the adapter's stop closes with the rest of its bus scope.
   * Gives up, closing whatever it built, once `signal` aborts.
   */
  async start(ctx: TwitchAppContext, signal: AbortSignal): Promise<ConnectOutcome> {
    if (signal.aborted) {
      this.lifetime.abort(signal.reason);
    } else {
      signal.addEventListener("abort", () => this.lifetime.abort(signal.reason), { once: true });
    }

    // Published when the streamer links (or relinks) Twitch in the UI. A
    // relink while connected swaps the token in place (see `relink`),
    // without a restart.
    await ctx.bus.subscribe(INTEGRATION_TOKEN_UPDATED_SUBJECT, async (msg: BusMessage) => {
      if (integrationOf(msg) !== "twitch") {
        return;
      }
      try {
        await this.onTokenUpdated(ctx);
      } catch (err) {
        if (this.lifetime.signal.aborted) {
          ctx.logger.debug("twitch: a Twitch token update was cut short by stop", { err: errorMessage(err) });
          return;
        }
        ctx.logger.error("twitch: failed to apply the updated Twitch token", { err: errorMessage(err) });
      }
    });

    return this.connect(ctx);
  }

  /**
   * Connect to Twitch with the linked account, or stay waiting when none is
   * linked. The channel is the configured one when set, else the account
   * that linked Twitch. A connect that fails or is aborted part-way closes
   * everything it built before rejecting.
   */
  private async connect(ctx: TwitchAppContext): Promise<ConnectOutcome> {
    const signal = this.lifetime.signal;
    signal.throwIfAborted();
    this.link = "connecting";
    const db = ctx.db;
    const connection: Connection = {
      closed: false,
      client: new TwitchClient({
        logger: ctx.logger,
        onAuthFailure: (err, { provider }) => this.onAuthFailure(ctx, connection, err, provider),
        channel: ctx.config.channel,
        getSetting: async (key) => {
          const response = await GetSetting({ key }, db);
          return response.setting.value.stringValue ?? undefined;
        },
        setSetting: async (key, value) => {
          await SetSetting({ key, value: { stringValue: value }, userId: "" }, db);
        },
        requestToken: requestTokenOverNats(busRequest(ctx.bus)),
      }),
    };

    // Only an engine that refreshes Twitch tokens itself has an app of its
    // own; one whose token comes from a dashboard asks the dashboard instead.
    // A rejected init keeps nothing, so there is nothing to close yet.
    let authProvider: AuthProvider;
    try {
      authProvider = await connection.client.init(ctx.config.app, signal);
    } catch (err) {
      this.link = "waiting";
      this.relinkPending = false;
      if (isNotLinked(err)) {
        ctx.logger.info("twitch: no Twitch account linked yet; waiting for a Twitch link");
        return "not_linked";
      }
      throw err;
    }

    let connected: Connected;
    try {
      connected = await this.build(ctx, connection, authProvider, signal);
      signal.throwIfAborted();
    } catch (err) {
      this.link = "waiting";
      this.relinkPending = false;
      try {
        await closeConnection(connection);
      } catch (closeErr) {
        ctx.logger.error("twitch: closing a failed connect also failed", { err: errorMessage(closeErr) });
      }
      throw err;
    }

    this.connection = connection;
    ctx.broadcaster = connected.broadcaster;
    ctx.twitchApi = connected.twitchApi;
    ctx.twitchEventBus = connection.eventBus;
    this.link = "connected";
    void this.track(this.seedLiveState(ctx, connected, signal));
    ctx.logger.info("twitch: connected", { broadcasterId: connected.broadcaster.id });
    if (this.relinkPending) {
      this.relinkPending = false;
      await this.relink(ctx);
    }
    return "connected";
  }

  /**
   * Builds the connection's parts on `connection` as it goes, so the caller
   * can close whatever was built when this rejects. Rejects with `signal`'s
   * reason once it aborts.
   */
  private async build(
    ctx: TwitchAppContext,
    connection: Connection,
    authProvider: AuthProvider,
    signal: AbortSignal
  ): Promise<Connected> {
    const apiClient = connection.client.ApiClient();
    const listener = connection.client.EventBusListener();
    const broadcaster = await untilAborted(connection.client.broadcaster(), signal);
    signal.throwIfAborted();

    const twitchApi = new TwitchApiClientImpl(
      apiClient,
      broadcaster,
      authProvider,
      this.deps.selfSent,
      enqueueShoutoutOverNats(busRequest(ctx.bus))
    );
    const events = new EventFactory({ source: TWITCH_EVENT_SOURCE });
    const messageBus: EventPublisher = {
      publish: (subject, data) => this.track(ctx.bus.publish(subject, data)),
    };
    const eventTarget: PublishTarget = { messageBus, logger: ctx.logger };
    const adBreakLeadSetting = new AdBreakLeadSetting(
      {
        listModuleSettings: async (moduleId) => (await ListModuleSettings({ moduleId }, ctx.db)).settings,
      },
      ctx.logger
    );
    const adBreakScheduler = new AdBreakScheduler({
      fetchSchedule: () => twitchApi.getAdSchedule({}),
      publishUpcoming: (event) => {
        void publishEvent(eventTarget, events.Twitch().adBreakUpcoming(event));
      },
      logger: ctx.logger,
      readLeadSeconds: () => adBreakLeadSetting.read(),
    });
    connection.adBreakScheduler = adBreakScheduler;

    const eventBusCtx = {
      broadcaster,
      logger: ctx.logger,
      messageBus,
      events,
      membershipEnricher: this.buildMembershipEnricher(ctx, apiClient),
      selfSent: this.deps.selfSent,
      onStreamLiveChange: (live: boolean) => adBreakScheduler.setLive(live),
    };
    const eventBus = new TwitchEventBus(eventBusCtx, listener);
    connection.eventBus = eventBus;
    await eventBus.start(signal);
    signal.throwIfAborted();
    if (!eventBus.isReady()) {
      // Deliberately not fatal: the `twitchapi` request/reply surface is
      // still worth serving, and Twurple keeps retrying refused
      // subscriptions. The adapter's /health detail shows the shortfall.
      ctx.logger.error("Twitch EventSub subscriptions incomplete; no events arrive for the missing ones", {
        established: eventBus.establishedCount(),
        expected: TwitchEventBus.expectedSubscriptionCount,
        failures: eventBus.failedSubscriptions(),
      });
    }
    return { apiClient, broadcaster, twitchApi, adBreakScheduler };
  }

  /**
   * EventSub does not replay a stream.online that happened before this
   * service connected, so a service started mid-stream asks Helix once.
   * A failed read leaves the scheduler offline until the next online event:
   * a missed heads-up is better than polling a stream that is not live.
   * Stops waiting, and seeds nothing, once `signal` aborts.
   */
  private async seedLiveState(ctx: TwitchAppContext, connected: Connected, signal: AbortSignal): Promise<void> {
    try {
      const stream = await untilAborted(
        connected.apiClient.streams.getStreamByUserId(connected.broadcaster.id),
        signal
      );
      connected.adBreakScheduler.seedLive(stream !== null);
    } catch (err) {
      if (signal.aborted) {
        return;
      }
      ctx.logger.warn("twitch: could not read whether the stream is live; ad heads-up waits for stream.online", {
        err: errorMessage(err),
      });
    }
  }

  /**
   * A token renewal failed, so every Helix call and EventSub reconnect made
   * with the token fails until one succeeds. That is a lost connection: the
   * host restarts the adapter with backoff, which reads the stored token
   * afresh, and parks it after repeated failures, with the reason in /health.
   * Ignored after stop and for a connection a relink already replaced.
   */
  private onAuthFailure(
    ctx: TwitchAppContext,
    connection: Connection,
    err: Error,
    provider: TwitchAuthProviderKind
  ): void {
    if (this.lifetime.signal.aborted || connection.closed) {
      ctx.logger.debug("twitch: ignoring a token renewal failure from a closed connection", { provider });
      return;
    }
    ctx.reportFault(`Twitch token renewal failed (${provider}): ${err.message}`);
  }

  /** Keeps `work` in `inFlight` until it settles, for `stop` to wait on. */
  private track<T>(work: Promise<T>): Promise<T> {
    this.inFlight.add(work);
    const forget = () => {
      this.inFlight.delete(work);
    };
    work.then(forget, forget);
    return work;
  }

  /** Closes the current connection and clears what the context exposed from it. Shared by relink and stop. */
  private async dropConnection(ctx: TwitchAppContext): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    ctx.twitchEventBus = undefined;
    ctx.twitchApi = undefined;
    ctx.broadcaster = undefined;
    if (connection) {
      await closeConnection(connection);
    }
  }

  /**
   * Follower status and subscription tier have to be read from Helix - no
   * badge carries either. Returns undefined when enrichment is switched off,
   * in which case both fields stay absent and grants against the follower and
   * tier groups simply match nobody, rather than matching everybody.
   */
  private buildMembershipEnricher(ctx: TwitchAppContext, apiClient: ApiClient): ChatterMembershipEnricher | undefined {
    const membership = ctx.config.membership;
    if (membership === undefined) {
      ctx.logger.info("twitch: chatter membership enrichment disabled by config");
      return undefined;
    }
    return new ChatterMembershipEnricher(new TwurpleMembershipLookup(apiClient), ctx.logger, {
      ...DEFAULT_ENRICHER_OPTIONS,
      ttlMs: membership.ttlMs,
      deadlineMs: membership.deadlineMs,
    });
  }

  /**
   * How many EventSub subscriptions Twitch has confirmed. An unsubscribed
   * listener is silent, not merely degraded, so a shortfall here means some
   * Twitch events are not reaching the engine at all.
   */
  eventSubStatus(): { established: number; expected: number; ready: boolean } {
    const eventBus = this.connection?.eventBus;
    return {
      established: eventBus?.establishedCount() ?? 0,
      expected: TwitchEventBus.expectedSubscriptionCount,
      ready: eventBus?.isReady() ?? false,
    };
  }

  /**
   * Ends this run for good: aborts a connect or relink in flight (which
   * closes what it built), closes the connection, then waits for in-flight
   * publishes and the live-state read. The host bounds how long it waits; the
   * bus scope it closes afterwards drains any relink handler still running.
   */
  async stop(ctx: TwitchAppContext): Promise<void> {
    this.lifetime.abort(new Error("the twitch application stopped"));
    this.relinkPending = false;
    this.link = "waiting";
    await this.dropConnection(ctx);
    await Promise.allSettled([...this.inFlight]);
  }

  /**
   * Answers one `twitchapi` request with the reply bytes. `deadline` is the
   * clock time the reply is due by; a `helix` call gives up at it, or at its
   * own deadline when that comes first.
   */
  async handleTwitchApiRequest(ctx: TwitchAppContext, body: Uint8Array, deadline: number): Promise<Uint8Array> {
    return withSpan("twitchapi.request", (span) => this.answer(ctx, body, deadline, span), {
      attributes: { "messaging.destination.name": TWITCHAPI_SUBJECT, "messaging.system": "nats" },
      kind: SpanKind.CONSUMER,
    });
  }

  private async answer(ctx: TwitchAppContext, body: Uint8Array, deadline: number, span: Span): Promise<Uint8Array> {
    let request: TwitchApiRequest | null;
    try {
      request = parseTwitchApiRequest(JSON.parse(decoder.decode(body)));
    } catch (err) {
      ctx.logger.error("twitchapi: failed to parse request", { err: errorMessage(err) });
      return this.errorReply("Invalid request payload");
    }

    if (!request?.command) {
      return this.errorReply("Missing command");
    }

    if (!ctx.twitchApi) {
      // A relink to another account reconnects in place; Twitch is linked, so
      // that window answers like the host's "starting" reply, for every command.
      if (this.link === "connecting") {
        return this.errorReply("Twitch is still connecting", "integration_unavailable");
      }
      // Only `helix` carries a code here: every other command's contract,
      // and `ctx.twitch`'s with it, documents this refusal as uncoded.
      return this.errorReply(
        "Twitch is not linked yet: the streamer has to connect Twitch first",
        request.command === HELIX_COMMAND ? "not_linked" : undefined
      );
    }

    if (!isTwitchApiCommand(request.command)) {
      ctx.logger.warn("twitchapi: unknown command", { command: request.command });
      return this.errorReply(`Unknown command: ${request.command}`);
    }

    span.updateName(`twitchapi.${request.command}`);
    span.setAttribute("rpc.method", request.command);

    const twitchApi = ctx.twitchApi as unknown as Record<
      string,
      (input: unknown, call: TwitchApiCall) => Promise<unknown>
    >;
    const call: TwitchApiCall = {
      helixDeadlineMs: Math.max(0, Math.min(HELIX_DEADLINE_MS, deadline - this.deps.clock.now())),
    };

    try {
      const result = await twitchApi[request.command](request.args ?? {}, call);
      return twitchApiReply(`twitchapi.${request.command}.result`, result, this.deps);
    } catch (err) {
      const message = errorMessage(err);
      ctx.logger.error("twitchapi: handler failed", { command: request.command, err: message });
      return this.errorReply(message, twitchApiErrorCodeOf(err));
    }
  }

  private errorReply(error: string, code?: TwitchApiReplyCode): Uint8Array {
    return twitchApiErrorReply(error, code, this.deps);
  }
}

/**
 * A `twitchapi.error` reply. `code` is set when the failure is one a caller
 * can act on differently (e.g. `missing_scope` means relink Twitch,
 * `rate_limited` means wait); absent for everything else.
 */
export function twitchApiErrorReply(
  error: string,
  code: TwitchApiReplyCode | undefined,
  deps: TwitchReplyDeps
): Uint8Array {
  return twitchApiReply(TWITCHAPI_ERROR_TYPE, code ? { error, code } : { error }, deps);
}

/** A `twitchapi` reply: a CloudEvent of `type` around `data`, with source `twitchapi`. */
function twitchApiReply(type: string, data: unknown, deps: TwitchReplyDeps): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      id: deps.ids.next(),
      type,
      source: TWITCHAPI_SUBJECT,
      time: new Date(deps.clock.now()).toISOString(),
      data,
    })
  );
}

/**
 * Settles as `work` does, or rejects with `signal`'s reason once it aborts,
 * whichever comes first. For calls that take no signal of their own: `work`
 * still runs to completion, but nobody waits for it.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

/**
 * The scoped bus as the shared request helpers call it. Both always pass a
 * timeout; a call without one is a wiring mistake, so it is refused rather
 * than given an invented default.
 */
function busRequest(
  bus: TwitchBus
): (subject: string, data: Uint8Array, opts?: { timeout?: number }) => Promise<{ data: Uint8Array }> {
  return (subject, data, opts) => {
    const timeout = opts?.timeout;
    if (timeout === undefined) {
      return Promise.reject(new Error(`a request on ${subject} needs a timeout`));
    }
    return bus.request(subject, data, { timeout });
  };
}

/** The integration a `setting.integration.token.updated` CloudEvent names, or undefined for any other body. */
function integrationOf(msg: BusMessage): unknown {
  try {
    const event = JSON.parse(decoder.decode(msg.data)) as { data?: { integration?: unknown } } | null;
    return event?.data?.integration;
  } catch {
    return undefined;
  }
}
