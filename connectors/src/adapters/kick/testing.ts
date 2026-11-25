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

const SIGNING = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};

/** A Kick webhook signing key: `pem` for the fake Kick server to serve, `sign` for deliveries. */
export async function kickSigningKey(): Promise<{ pem: string; sign(text: string): Promise<string> }> {
  const pair = await crypto.subtle.generateKey(SIGNING, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const lines = btoa(String.fromCharCode(...spki)).match(/.{1,64}/g) ?? [];
  return {
    pem: `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`,
    sign: async (text) => {
      const signature = new Uint8Array(
        await crypto.subtle.sign(SIGNING, pair.privateKey, new TextEncoder().encode(text))
      );
      return btoa(String.fromCharCode(...signature));
    },
  };
}

/** An `engine.kick.webhook` request as the api builds it from Kick's delivery, signed with `key`. */
export async function kickDelivery(
  key: { sign(text: string): Promise<string> },
  delivery: { messageId: string; timestamp: string; eventType: string; body: unknown; eventVersion?: string }
): Promise<Uint8Array> {
  const raw = JSON.stringify(delivery.body);
  return new TextEncoder().encode(
    JSON.stringify({
      messageId: delivery.messageId,
      subscriptionId: "01SUBSCRIPTION",
      signature: await key.sign(`${delivery.messageId}.${delivery.timestamp}.${raw}`),
      timestamp: delivery.timestamp,
      eventType: delivery.eventType,
      eventVersion: delivery.eventVersion ?? "1",
      bodyBase64: btoa(String.fromCharCode(...new TextEncoder().encode(raw))),
    })
  );
}
