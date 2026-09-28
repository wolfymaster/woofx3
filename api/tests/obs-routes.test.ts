import { describe, expect, test } from "bun:test";
import { OBS_LIST_TIMEOUT_MS, obsRoutes } from "../src/routes/obs";

type Request = { subject: string; body: Record<string, unknown>; timeout?: number };

/** `listObsScenes` touches only `nats` and `logger` on the route host. */
function setup(answer: (() => unknown) | null) {
  const requests: Request[] = [];
  const nats =
    answer === null
      ? null
      : {
          async request(subject: string, data: Uint8Array, opts?: { timeout?: number }) {
            requests.push({ subject, body: JSON.parse(new TextDecoder().decode(data)), timeout: opts?.timeout });
            const reply = answer();
            return { subject: "_INBOX.x", data: new TextEncoder().encode(JSON.stringify(reply)) };
          },
        };
  const ctx = { nats, logger: { info() {}, warn() {}, error() {}, debug() {} } };
  const list = () => obsRoutes.listObsScenes.call(ctx as never);
  return { requests, list };
}

describe("listObsScenes", () => {
  test("asks the scene manager for a scene listing and returns its scenes", async () => {
    const scenes = [
      { name: "Main", sources: [{ name: "Camera", sceneItemId: 1, inputKind: "v4l2_input", enabled: true }] },
    ];
    const { requests, list } = setup(() => ({ ok: true, scenes }));

    expect(await list()).toEqual({ available: true, scenes });
    expect(requests).toHaveLength(1);
    expect(requests[0].subject).toBe("engine.obs.command");
    expect(requests[0].timeout).toBe(OBS_LIST_TIMEOUT_MS);
    expect(requests[0].body.type).toBe("engine.obs.command");
    expect(requests[0].body.data).toEqual({ command: "list_scenes" });
  });

  test("passes on the scene manager's reason when OBS is not connected", async () => {
    const { list } = setup(() => ({ ok: false, error: "OBS is not connected to the scene manager" }));
    expect(await list()).toEqual({ available: false, reason: "OBS is not connected to the scene manager" });
  });

  test("reports unavailable instead of throwing when nobody answers", async () => {
    const { list } = setup(() => {
      throw new Error("503");
    });
    const listing = await list();
    expect(listing.available).toBe(false);
    expect(listing.available ? "" : listing.reason).toContain("the scene manager did not answer");
  });

  test("reports unavailable without a message bus", async () => {
    const { list } = setup(null);
    expect(await list()).toEqual({ available: false, reason: "the message bus is not connected" });
  });
});
