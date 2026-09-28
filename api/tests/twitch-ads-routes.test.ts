import { describe, expect, test } from "bun:test";
import { twitchAdsRoutes } from "../src/routes/twitch-ads";
import { TwitchCommandError } from "../src/twitch-ads";

type Sent = { subject: string; command: string };

/**
 * Stands in for the twitch service on the bus: records each request and
 * answers with the envelope the service would send.
 */
function hostAnswering(reply: Record<string, unknown> | Error) {
  const sent: Sent[] = [];
  const host = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    nats: {
      async request(subject: string, data: Uint8Array) {
        const envelope = JSON.parse(new TextDecoder().decode(data));
        sent.push({ subject, command: envelope.data.command });
        if (reply instanceof Error) {
          throw reply;
        }
        return { data: new TextEncoder().encode(JSON.stringify(reply)) };
      },
    },
  };
  return { host, sent };
}

const SCHEDULE = {
  nextAdAt: "2026-09-28T18:10:00.000Z",
  lastAdAt: null,
  durationSeconds: 90,
  prerollFreeSeconds: 0,
  snoozeCount: 3,
  snoozeRefreshAt: "2026-09-28T19:00:00.000Z",
  serverNow: "2026-09-28T18:00:00.000Z",
};

async function rejectionOf(promise: Promise<unknown>): Promise<TwitchCommandError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof TwitchCommandError) {
      return err;
    }
    throw err;
  }
  throw new Error("expected a rejection");
}

describe("twitch ad routes", () => {
  test("getAdSchedule asks the twitch service and returns its data", async () => {
    const { host, sent } = hostAnswering({ type: "twitchapi.getAdSchedule.result", data: SCHEDULE });

    const schedule = await twitchAdsRoutes.getAdSchedule.call(host as never);

    expect(schedule).toEqual(SCHEDULE);
    expect(sent).toEqual([{ subject: "twitchapi", command: "getAdSchedule" }]);
  });

  test("snoozeNextAd returns the new snooze state", async () => {
    const result = {
      snoozeCount: 2,
      snoozeRefreshAt: "2026-09-28T19:00:00.000Z",
      nextAdAt: "2026-09-28T18:15:00.000Z",
      serverNow: "2026-09-28T18:00:00.000Z",
    };
    const { host, sent } = hostAnswering({ type: "twitchapi.snoozeNextAd.result", data: result });

    expect(await twitchAdsRoutes.snoozeNextAd.call(host as never)).toEqual(result);
    expect(sent[0]?.command).toBe("snoozeNextAd");
  });

  test("a missing scope rejects with the reconnect message and its code", async () => {
    const { host } = hostAnswering({
      type: "twitchapi.error",
      data: {
        error: "snoozeNextAd: Twitch has not granted channel:manage:ads; reconnect Twitch to allow ad controls",
        code: "missing_scope",
      },
    });

    const err = await rejectionOf(twitchAdsRoutes.snoozeNextAd.call(host as never));
    expect(err.code).toBe("missing_scope");
    expect(err.message).toContain("reconnect Twitch to allow ad controls");
  });

  test("an unlinked Twitch account and a silent service are told apart", async () => {
    const unlinked = hostAnswering({
      type: "twitchapi.error",
      data: { error: "Twitch is not linked yet: the streamer has to connect Twitch first" },
    });
    expect((await rejectionOf(twitchAdsRoutes.getAdSchedule.call(unlinked.host as never))).code).toBe("unlinked");

    const silent = hostAnswering(new Error("503 no responders"));
    expect((await rejectionOf(twitchAdsRoutes.getAdSchedule.call(silent.host as never))).code).toBe("unavailable");
  });

  test("rejects without a message bus", async () => {
    const host = { logger: { info() {} }, nats: null };
    await expect(twitchAdsRoutes.getAdSchedule.call(host as never)).rejects.toThrow("NATS client not available");
  });
});
