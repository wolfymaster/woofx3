import { describe, expect, it } from "bun:test";
import type { HttpDeps } from "../../src/http";
import { handleEventCompletedRoute, handleEventDeliveredRoute } from "../../src/routes/events";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function deps(failed: string[]) {
  return {
    ctx: { logger, services: { db: { client: { updateAlertLifecycle: async () => ({}) } } } },
    sessionTokens: { verify: async (token: string) => (token === "good" ? { sceneId: "scene-1" } : null) },
    deliveryStore: {
      ackDelivered: async () => failed,
      ackCompleted: async () => ({ closed: [], failed }),
    },
  } as unknown as HttpDeps;
}

function ack(kind: string): Request {
  return new Request(`http://scene.test/scene/scene-1/events/evt-1/${kind}`, {
    method: "POST",
    headers: { Cookie: "sm_session_scene-1=good", "Content-Type": "application/json" },
    body: JSON.stringify({ instanceIds: ["inst-a"] }),
  });
}

describe("ack routes", () => {
  it("answer 200 when every ack was recorded", async () => {
    expect((await handleEventDeliveredRoute(ack("delivered"), "scene-1", "evt-1", deps([]))).status).toBe(200);
    expect((await handleEventCompletedRoute(ack("completed"), "scene-1", "evt-1", deps([]))).status).toBe(200);
  });

  it("answer 503 when some could not be, so the page sends them again", async () => {
    const delivered = await handleEventDeliveredRoute(ack("delivered"), "scene-1", "evt-1", deps(["inst-a"]));
    const completed = await handleEventCompletedRoute(ack("completed"), "scene-1", "evt-1", deps(["inst-a"]));
    expect(delivered.status).toBe(503);
    expect(completed.status).toBe(503);
    expect(await completed.json()).toEqual({ error: "unavailable", instanceIds: ["inst-a"] });
  });
});
