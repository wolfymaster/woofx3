import { describe, expect, it, mock } from "bun:test";
import type { HttpDeps } from "../../src/http";
import { handleWidgetStatusRoute } from "../../src/routes/events";
import { SceneDocuments } from "../../src/scene/scene-documents";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function deps(placements: Record<string, { moduleId: string }>) {
  const upsertWidgetStatus = mock(async (_req: Record<string, unknown>) => ({}));
  const d = {
    ctx: { logger, services: { db: { client: { upsertWidgetStatus } } } },
    sessionTokens: { verify: async (token: string) => (token === "good" ? { sceneId: "scene-1" } : null) },
    sceneDocuments: {
      snapshot: async (sceneId: string) => (sceneId === "scene-1" ? { sceneId, meta: placements } : null),
      // The real lookup, over the fake snapshot above.
      placementMeta(sceneId: string, instanceId: string) {
        return SceneDocuments.prototype.placementMeta.call(this as never, sceneId, instanceId);
      },
    },
  };
  return { deps: d as unknown as HttpDeps, upsertWidgetStatus };
}

function report(instanceId: string, body: Record<string, unknown>): Request {
  return new Request(`http://scene.test/scene/scene-1/widget/${instanceId}/status`, {
    method: "POST",
    headers: { Cookie: "sm_session_scene-1=good", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleWidgetStatusRoute", () => {
  it("files a scene placement's report under the placement's module, whatever the body names", async () => {
    const { deps: d, upsertWidgetStatus } = deps({ "counter-1": { moduleId: "woofx3" } });

    const resp = await handleWidgetStatusRoute(
      report("counter-1", { moduleId: "spotify", key: "count", value: 3 }),
      "scene-1",
      "counter-1",
      d
    );

    expect(resp.status).toBe(200);
    expect(upsertWidgetStatus).toHaveBeenCalledTimes(1);
    expect(upsertWidgetStatus.mock.calls[0]![0]).toMatchObject({ moduleId: "woofx3", instanceId: "counter-1" });
  });

  it("files an alert widget's report under the module the page took from the alert layout", async () => {
    const { deps: d, upsertWidgetStatus } = deps({ "counter-1": { moduleId: "woofx3" } });

    await handleWidgetStatusRoute(
      report("evt-1.w1", { moduleId: "woofx3", key: "done", value: true }),
      "scene-1",
      "evt-1.w1",
      d
    );

    expect(upsertWidgetStatus.mock.calls[0]![0]).toMatchObject({ moduleId: "woofx3", instanceId: "evt-1.w1" });
  });
});
