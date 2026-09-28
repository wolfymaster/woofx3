import { describe, expect, mock, test } from "bun:test";
import { twitchRoutes } from "../src/routes/twitch";

type Reply = { type: string; data: unknown };

/** A route host whose NATS answers every request with `reply`, recording what was asked. */
function host(reply: Reply | Error) {
  const request = mock(async (_subject: string, _data: Uint8Array, _opts?: unknown) => {
    if (reply instanceof Error) {
      throw reply;
    }
    return { subject: "inbox", data: new TextEncoder().encode(JSON.stringify(reply)) };
  });
  return {
    ctx: { nats: { request } },
    sent: () => {
      const [subject, data, opts] = request.mock.calls[0] ?? [];
      return { subject, opts, body: JSON.parse(new TextDecoder().decode(data)) };
    },
  };
}

function call<K extends keyof typeof twitchRoutes>(
  ctx: object,
  name: K,
  ...args: Parameters<(typeof twitchRoutes)[K]>
): ReturnType<(typeof twitchRoutes)[K]> {
  const route = twitchRoutes[name] as unknown as (...a: unknown[]) => ReturnType<(typeof twitchRoutes)[K]>;
  return route.call(ctx, ...args);
}

describe("twitch routes", () => {
  test("updateStreamInfo sends updateStream to the twitch service as a CloudEvent and returns its result", async () => {
    const result = { ok: true, title: "New title", categoryId: "509658", categoryName: "Just Chatting" };
    const { ctx, sent } = host({ type: "twitchapi.updateStream.result", data: result });

    expect(await call(ctx, "updateStreamInfo", { title: "New title", category: "just chatting" })).toEqual(
      result as never
    );
    const { subject, body, opts } = sent();
    expect(subject).toBe("twitchapi");
    expect(body.source).toBe("api");
    expect(body.data).toEqual({ command: "updateStream", args: { title: "New title", category: "just chatting" } });
    expect(opts).toEqual({ timeout: 10_000 });
  });

  test("each route names its twitch service command", async () => {
    const cases = [
      ["getStreamInfo", [], "getStreamInfo", {}],
      ["createStreamMarker", [{ description: "clutch" }], "createMarker", { description: "clutch" }],
      ["createStreamMarker", [], "createMarker", {}],
      ["searchTwitchCategories", [{ query: "irl", first: 5 }], "searchCategories", { query: "irl", first: 5 }],
    ] as const;
    for (const [route, args, command, sentArgs] of cases) {
      const { ctx, sent } = host({ type: `twitchapi.${command}.result`, data: {} });
      await (call as (...a: unknown[]) => Promise<unknown>)(ctx, route, ...args);
      expect(sent().body.data).toEqual({ command, args: sentArgs });
    }
  });

  test("rejects with the twitch service's own error", async () => {
    const { ctx } = host({
      type: "twitchapi.error",
      data: { error: "createMarker: the channel is not live; Twitch only places markers on a live stream" },
    });

    await expect(call(ctx, "createStreamMarker", {})).rejects.toThrow("the channel is not live");
  });

  test("says the twitch service is not running when nothing answers", async () => {
    const { ctx } = host(new Error("503 no responders available"));

    await expect(call(ctx, "getStreamInfo")).rejects.toThrow("The Twitch service is not running");
  });

  test("passes a timeout through unchanged", async () => {
    const { ctx } = host(new Error("TIMEOUT"));

    await expect(call(ctx, "searchTwitchCategories", { query: "x" })).rejects.toThrow("TIMEOUT");
  });

  test("refuses without a NATS connection", async () => {
    await expect(call({ nats: null }, "getStreamInfo")).rejects.toThrow("NATS client not available");
  });
});
