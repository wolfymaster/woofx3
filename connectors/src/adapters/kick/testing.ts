import type { KickTokenGrant } from "@woofx3/api/webhooks";
import { KICK_TOKEN_SUBJECT, type KickTokenReply } from "@woofx3/common/cloudevents/Kick/token";
import { type KickConfig, KickEnvSchema, kickConfig } from "../../config/kick";
import type { Adapter } from "../../host/adapter";
import type { LiveStatusHandle } from "../../host/live-status";
import { Supervisor } from "../../host/supervisor";
import { FakeBus, FakeTime, halfRandom, noCompanion, RecordingLogger } from "../../host/testing";

export const KICK_GRANT: KickTokenGrant = {
  userId: "4242",
  accessToken: "token-1",
  scope: ["user:read", "channel:read", "chat:write", "events:subscribe", "moderation:ban"],
  expiresIn: 7200,
  obtainmentTimestamp: Date.now(),
  clientId: "kick-app",
};

/** A bus whose api answers `engine.kick.token` with `tokenReply`, as the api's KickTokenSource does. */
export class KickTokenBus extends FakeBus {
  tokenReply: KickTokenReply = { token: KICK_GRANT };
  readonly tokenRequests: unknown[] = [];

  override async request(
    subject: string,
    data: Uint8Array,
    opts: { timeout: number }
  ): Promise<{ subject: string; data: Uint8Array }> {
    if (subject !== KICK_TOKEN_SUBJECT) {
      return super.request(subject, data, opts);
    }
    this.tokenRequests.push(JSON.parse(new TextDecoder().decode(data)));
    return { subject, data: new TextEncoder().encode(JSON.stringify(this.tokenReply)) };
  }
}

/** The shipped Kick configuration, pointed at a fake Kick server. */
export function kickConfigAt(apiBaseUrl: string): KickConfig {
  return { ...kickConfig(KickEnvSchema.parse({})), apiBaseUrl };
}

/** A live status board that records what the adapter told it. */
export function recordingLiveStatus() {
  const seeded: { live: boolean; startedAt?: string }[] = [];
  const changed: { live: boolean; startedAt?: string }[] = [];
  const handle: LiveStatusHandle = {
    reset: () => {},
    seed: async (read, signal) => {
      seeded.push(await read(signal));
    },
    changed: (status) => {
      changed.push(status);
    },
  };
  return { seeded, changed, board: { forAdapter: () => handle, clear: () => {} } };
}

/** `adapter` under a real supervisor on `bus`, with `apply` to link or unlink it. */
export function supervisedKick(adapter: Adapter, bus: FakeBus, time = new FakeTime()) {
  const live = recordingLiveStatus();
  const logger = new RecordingLogger();
  const supervisor = new Supervisor(
    new Map([["kick", adapter]]),
    {
      backoff: { baseMs: 1_000, maxMs: 10_000 },
      park: { afterFailures: 5, windowMs: 600_000 },
      stopDeadlineMs: 5_000,
      subscriptionLimits: { concurrency: 4, queueCap: 16 },
    },
    {
      bus,
      dbProxy: { baseURL: "http://db.test" },
      companion: noCompanion,
      liveStatus: live.board,
      clock: time,
      random: halfRandom,
      timers: time,
      logger,
    }
  );
  const apply = async (connected: boolean, enabled: boolean) => {
    await supervisor.reconcile(new Map([["kick", { connected, enabled }]]), new Set(["kick" as const]));
    await supervisor.whenIdle();
  };
  return { supervisor, apply, live, logger };
}
