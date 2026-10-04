import { describe, expect, mock, test } from "bun:test";
import { enqueueShoutout, parseEnqueueResponse } from "../src/shoutout-queue";

const TARGET = {
  twitchUserId: "7",
  login: "raider",
  displayName: "Raider",
  profileImageUrl: "https://img/7.png",
  broadcasterType: "affiliate",
};

function deps(answer: unknown, clientId: string | null = "dash-client") {
  const request = mock(async (_request: unknown, _clientId: string) => {
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  });
  return {
    request,
    deps: { linkedDashboardClientId: async () => clientId, dashboard: () => ({ request }) },
  };
}

describe("enqueueShoutout", () => {
  test("asks the dashboard that linked Twitch, and reports the place in line", async () => {
    const { request, deps: d } = deps({ queued: true, position: 3, alreadyQueued: false });

    expect(await enqueueShoutout(TARGET, d)).toEqual({ queued: { position: 3, alreadyQueued: false } });
    expect(request.mock.calls[0]).toEqual([{ type: "shoutout.enqueue.requested", ...TARGET }, "dash-client"]);
  });

  test("is unavailable when Twitch was linked on the engine itself", async () => {
    const { request, deps: d } = deps({ queued: true, position: 1, alreadyQueued: false }, null);

    expect(await enqueueShoutout(TARGET, d)).toEqual({ unavailable: "Twitch is not linked through a dashboard" });
    expect(request).not.toHaveBeenCalled();
  });

  test("reports a dashboard that cannot be reached or has no Twitch link as an error", async () => {
    expect(await enqueueShoutout(TARGET, deps(new Error("dashboard answered HTTP 500")).deps)).toEqual({
      error: "dashboard answered HTTP 500",
    });
    expect(await enqueueShoutout(TARGET, deps({ queued: false, reason: "not_linked" }).deps)).toEqual({
      error: "the dashboard has no Twitch link to send shoutouts with",
    });
    const noConnection = { linkedDashboardClientId: async () => "dash-client", dashboard: () => null };
    expect(await enqueueShoutout(TARGET, noConnection)).toEqual({
      error: "no dashboard connection to queue the shoutout on",
    });
  });

  test("refuses a request without the user's identity before asking", async () => {
    const { request, deps: d } = deps({ queued: true, position: 1, alreadyQueued: false });

    expect(await enqueueShoutout({ login: "raider" }, d)).toEqual({
      error: "shoutout request needs twitchUserId, login and displayName",
    });
    expect(await enqueueShoutout(null, d)).toHaveProperty("error");
    expect(request).not.toHaveBeenCalled();
  });
});

describe("parseEnqueueResponse", () => {
  test("reads a queued answer, defaulting alreadyQueued to false", () => {
    expect(parseEnqueueResponse({ queued: true, position: 2 })).toEqual({
      queued: true,
      position: 2,
      alreadyQueued: false,
    });
  });

  test("refuses anything that is not an answer", () => {
    expect(() => parseEnqueueResponse({ success: true })).toThrow("no queued field");
    expect(() => parseEnqueueResponse({ queued: true, position: 0 })).toThrow("malformed");
    expect(() => parseEnqueueResponse({ queued: false, reason: "nope" })).toThrow("known reason");
  });
});
