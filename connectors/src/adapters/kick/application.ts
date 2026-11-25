import { INTEGRATION_TOKEN_UPDATED_SUBJECT } from "@woofx3/common/integrations/integration-settings";
import type { KickConfig } from "../../config/kick";
import type { AdapterContext } from "../../host/adapter";
import type { Clock } from "../../host/deps";
import type { BusMessage } from "../../host/scoped-bus";
import { KickApi, type KickApiFailure, type KickChannel } from "./lib/kick-api";
import { KickTokenClient } from "./lib/token";

/** The linked Kick channel, fixed for one run. */
export interface KickBroadcaster {
  userId: string;
  slug: string;
  name: string;
}

export interface KickApplicationDeps {
  config: KickConfig;
  clock: Clock;
  fetch: typeof fetch;
}

/**
 * One run of the Kick adapter: from a start to its stop, with the token, the
 * REST client and the broadcaster it found. Every call it makes is aborted
 * when the run stops, so nothing from one run outlives it.
 */
export default class KickApplication {
  private readonly lifetime = new AbortController();
  private readonly tokens: KickTokenClient;
  readonly api: KickApi;
  private linked: { broadcaster: KickBroadcaster } | undefined;

  constructor(
    deps: KickApplicationDeps,
    private readonly ctx: AdapterContext
  ) {
    this.tokens = new KickTokenClient({
      request: (subject, data, opts) => ctx.bus.request(subject, data, opts),
      clock: deps.clock,
      timeoutMs: deps.config.tokenRequestTimeoutMs,
      expiryMarginMs: deps.config.tokenExpiryMarginMs,
    });
    this.api = new KickApi({
      fetch: deps.fetch,
      token: this.tokens,
      clock: deps.clock,
      baseUrl: deps.config.apiBaseUrl,
      timeoutMs: deps.config.requestTimeoutMs,
      userAgent: deps.config.userAgent,
      signal: this.lifetime.signal,
    });
  }

  get broadcaster(): KickBroadcaster | undefined {
    return this.linked?.broadcaster;
  }

  /**
   * Finds the linked broadcaster and seeds the stream's live state. Rejects
   * when no Kick account is linked after all or Kick could not be asked, so
   * the host marks the adapter degraded and retries with backoff.
   */
  async start(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      this.lifetime.abort(signal.reason);
    } else {
      signal.addEventListener("abort", () => this.lifetime.abort(signal.reason), { once: true });
    }
    await this.ctx.bus.subscribe(INTEGRATION_TOKEN_UPDATED_SUBJECT, (msg) => this.onTokenUpdated(msg));
    this.linked = { broadcaster: await this.findBroadcaster() };
    await this.ctx.liveStatus.seed(() => this.readLive(), this.lifetime.signal);
  }

  async stop(): Promise<void> {
    this.lifetime.abort(new Error("the Kick adapter stopped"));
  }

  private async findBroadcaster(): Promise<KickBroadcaster> {
    const user = await this.api.self();
    if (!user.ok) {
      throw startFailure("read the linked Kick user", user.error);
    }
    const channel = await this.ownChannel();
    if (channel.broadcasterUserId !== user.value.userId) {
      throw new Error(
        `Kick answered channel ${channel.broadcasterUserId} for user ${user.value.userId}; the link is inconsistent`
      );
    }
    return { userId: user.value.userId, slug: channel.slug, name: user.value.name };
  }

  private async ownChannel(): Promise<KickChannel> {
    const channels = await this.api.channels("self");
    if (!channels.ok) {
      throw startFailure("read the linked Kick channel", channels.error);
    }
    const channel = channels.value[0];
    if (channel === undefined) {
      throw new Error("Kick has no channel for the linked user");
    }
    return channel;
  }

  private async readLive(): Promise<{ live: boolean; startedAt?: string }> {
    const channel = await this.ownChannel();
    const startedAt = channel.stream.startedAt;
    if (!channel.stream.isLive) {
      return { live: false };
    }
    return startedAt === null ? { live: true } : { live: true, startedAt: new Date(startedAt).toISOString() };
  }

  /**
   * A relink: the next call asks the api for the new token. The same
   * broadcaster keeps the run; another one is a different channel, so the
   * host restarts the run around it.
   */
  private async onTokenUpdated(msg: BusMessage): Promise<void> {
    if (integrationOf(msg) !== "kick") {
      return;
    }
    this.tokens.forget();
    const before = this.linked?.broadcaster;
    const user = await this.api.self();
    if (this.lifetime.signal.aborted) {
      return;
    }
    if (!user.ok) {
      this.ctx.logger.warn("kick: could not read the relinked Kick user", { err: failureText(user.error) });
      return;
    }
    if (before !== undefined && user.value.userId !== before.userId) {
      this.ctx.reportFault(`Kick was relinked to another channel (${user.value.userId})`);
    }
  }
}

function integrationOf(msg: BusMessage): unknown {
  try {
    const event = JSON.parse(new TextDecoder().decode(msg.data)) as { data?: { integration?: unknown } } | null;
    return event?.data?.integration;
  } catch {
    // Not a CloudEvent: it names no integration, so it is not Kick's.
    return undefined;
  }
}

function startFailure(doing: string, failure: KickApiFailure): Error {
  if (failure.kind === "not_linked") {
    return new Error("Kick is not linked: no Kick token is stored, or it has to be linked again");
  }
  return new Error(`could not ${doing}: ${failureText(failure)}`);
}

export function failureText(failure: KickApiFailure): string {
  switch (failure.kind) {
    case "http": {
      return failure.message;
    }
    case "timeout": {
      return "Kick did not answer in time";
    }
    case "unreachable": {
      return `Kick could not be reached: ${failure.detail}`;
    }
    case "not_linked": {
      return "Kick is not linked";
    }
    case "malformed": {
      return `Kick's answer could not be read: ${failure.detail}`;
    }
  }
}
