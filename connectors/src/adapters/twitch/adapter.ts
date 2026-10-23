import { TWITCHAPI_SUBJECT } from "@woofx3/common/cloudevents/Twitch/commands";
import { EventType as TwitchEventType } from "@woofx3/common/cloudevents/Twitch/events";
import { INTEGRATION_TOKEN_UPDATED_SUBJECT } from "@woofx3/common/integrations/integration-settings";
import { TWITCH_TOKEN_SUBJECT } from "@woofx3/twitch/dashboard-auth-provider";
import type { TwitchConfig } from "../../config/twitch";
import type {
  Adapter,
  AdapterContext,
  AdapterManifest,
  AdapterModule,
  ServedRequestContext,
  Unavailable,
} from "../../host/adapter";
import type { LinkState } from "../../host/link-readers";
import TwitchApplication, { type TwitchAppContext, type TwitchReplyDeps, twitchApiErrorReply } from "./application";
import { SHOUTOUT_ENQUEUE_SUBJECT } from "./lib/shoutoutQueue";

/**
 * The host's reply budget for `twitchapi`, time spent held while the adapter
 * starts included. Below the api's TWITCH_HELIX_TIMEOUT_MS (10_000) and the
 * 10_000 the sandbox's `ctx.twitch` and woofwoofwoof's built-in commands wait,
 * so a caller always gets a reply; above HELIX_DEADLINE_MS (8_000), so a Helix call
 * reports its own timeout first.
 */
export const TWITCH_API_SERVED_BUDGET_MS = 9_000;

/** Every subject the adapter publishes: one per Twitch event type. */
export const TWITCH_EVENT_SUBJECTS: readonly string[] = Object.values(TwitchEventType);

/** Why the host is answering for a stopped adapter, in words a streamer can act on. */
const UNAVAILABLE_MESSAGES: Record<Unavailable["reason"], string> = {
  stopped: "Twitch is turned off or not running in this engine",
  starting: "Twitch is turned off or not running in this engine: it is still connecting, try again shortly",
  parked:
    "Twitch is turned off or not running in this engine: it failed repeatedly and waits until Twitch is relinked or re-enabled",
};

const NOT_LINKED_MESSAGE = "Twitch is not linked yet: the streamer has to connect Twitch first";

/**
 * The `twitchapi` reply while the adapter cannot answer. Coded for every
 * command, since the host answers before reading the request: `not_linked`
 * when no account is linked, else `integration_unavailable`. A link not read
 * yet counts as linked, because nothing says the streamer has to link.
 */
export function twitchApiUnavailableReply(unavailable: Unavailable, deps: TwitchReplyDeps): Uint8Array {
  if (unavailable.link !== null && !unavailable.link.connected) {
    return twitchApiErrorReply(NOT_LINKED_MESSAGE, "not_linked", deps);
  }
  return twitchApiErrorReply(UNAVAILABLE_MESSAGES[unavailable.reason], "integration_unavailable", deps);
}

export interface TwitchAdapterDeps extends TwitchReplyDeps {
  config: TwitchConfig;
}

/**
 * Twitch as a host adapter: runs while Twitch is linked and enabled, turns
 * EventSub into bus events, and answers `twitchapi` through the host. Each
 * start builds a fresh TwitchApplication, so nothing from an earlier run
 * leaks into the next one.
 */
export class TwitchAdapter implements Adapter {
  readonly manifest: AdapterManifest;
  private run: { app: TwitchApplication; ctx: TwitchAppContext } | undefined;

  constructor(private readonly deps: TwitchAdapterDeps) {
    this.manifest = {
      id: "twitch",
      publishes: TWITCH_EVENT_SUBJECTS,
      subscribes: [INTEGRATION_TOKEN_UPDATED_SUBJECT],
      requests: [TWITCH_TOKEN_SUBJECT, SHOUTOUT_ENQUEUE_SUBJECT],
      serves: [
        {
          subject: TWITCHAPI_SUBJECT,
          budgetMs: TWITCH_API_SERVED_BUDGET_MS,
          handle: (request, ctx) => this.handle(request, ctx),
          unavailableReply: (unavailable) => twitchApiUnavailableReply(unavailable, deps),
        },
      ],
    };
  }

  desired(link: LinkState): boolean {
    return link.connected && link.enabled;
  }

  /**
   * Rejects when no Twitch token is stored after all, so the host marks the
   * adapter degraded and retries: the link said connected, and the next
   * settings read settles which one is right.
   */
  async start(ctx: AdapterContext, signal: AbortSignal): Promise<void> {
    if (this.run !== undefined) {
      throw new Error("the twitch adapter is already running; the host never starts it twice");
    }
    const app = new TwitchApplication(this.deps);
    const appCtx: TwitchAppContext = { logger: ctx.logger, bus: ctx.bus, db: ctx.dbProxy, config: this.deps.config };
    this.run = { app, ctx: appCtx };
    const outcome = await app.start(appCtx, signal);
    if (outcome === "not_linked") {
      throw new Error("Twitch is not linked: no Twitch token is stored");
    }
  }

  async stop(): Promise<void> {
    const run = this.run;
    this.run = undefined;
    await run?.app.stop(run.ctx);
  }

  detail(): Record<string, unknown> {
    const run = this.run;
    return {
      broadcasterId: run?.ctx.broadcaster?.id ?? null,
      eventSub: run?.app.eventSubStatus() ?? null,
    };
  }

  private async handle(request: Uint8Array, ctx: ServedRequestContext): Promise<Uint8Array> {
    const run = this.run;
    if (run === undefined) {
      throw new Error("twitchapi reached the twitch adapter while it is not running");
    }
    return run.app.handleTwitchApiRequest(run.ctx, request, ctx.deadline);
  }
}

/** The registry entry's module: one adapter for the life of the process, no host state. */
export function twitchAdapterModule(deps: TwitchAdapterDeps): AdapterModule {
  return { create: () => new TwitchAdapter(deps) };
}
