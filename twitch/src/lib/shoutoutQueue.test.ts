import { describe, expect, mock, test } from "bun:test";
import { enqueueShoutoutOverNats, SHOUTOUT_ENQUEUE_SUBJECT } from "./shoutoutQueue";

const TARGET = { twitchUserId: "7", login: "raider", displayName: "Raider" };

function replying(body: unknown) {
  return mock(async (_subject: string, _data: Uint8Array, _opts?: { timeout?: number }) => ({
    data: new TextEncoder().encode(JSON.stringify(body)),
  }));
}

function failing(err: Error) {
  return mock(async (_subject: string, _data: Uint8Array, _opts?: { timeout?: number }) => {
    throw err;
  });
}

describe("enqueueShoutoutOverNats", () => {
  test("asks the api service and reads the place in line", async () => {
    const request = replying({ queued: { position: 4, alreadyQueued: false } });

    expect(await enqueueShoutoutOverNats(request)(TARGET)).toEqual({
      kind: "queued",
      position: 4,
      alreadyQueued: false,
    });
    const [subject, data] = request.mock.calls[0];
    expect(subject).toBe(SHOUTOUT_ENQUEUE_SUBJECT);
    expect(JSON.parse(new TextDecoder().decode(data))).toEqual(TARGET);
  });

  test("has no queue when the engine's Twitch link is its own, or the api service is not running", async () => {
    expect(await enqueueShoutoutOverNats(replying({ unavailable: "not via a dashboard" }))(TARGET)).toEqual({
      kind: "no_queue",
      reason: "not via a dashboard",
    });
    const noResponders = new Error("503", { cause: Object.assign(new Error("x"), { name: "NoResponders" }) });
    expect(await enqueueShoutoutOverNats(failing(noResponders))(TARGET)).toMatchObject({ kind: "no_queue" });
  });

  test("throws on a queue error or a timeout, so nothing is sent twice", async () => {
    await expect(enqueueShoutoutOverNats(replying({ error: "HTTP 500" }))(TARGET)).rejects.toThrow(
      "could not queue the shoutout: HTTP 500"
    );
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    await expect(enqueueShoutoutOverNats(failing(timeout))(TARGET)).rejects.toThrow("did not confirm");
    await expect(enqueueShoutoutOverNats(replying({ nope: 1 }))(TARGET)).rejects.toThrow("malformed");
  });
});
