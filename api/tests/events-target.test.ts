import { describe, expect, mock, test } from "bun:test";
import type { EventsTarget, Woofx3EngineApi } from "@woofx3/api";
import { Api, type ApiOptions } from "../src/api";
import { ApiSession } from "../src/api-session";
import { SessionLease } from "../src/client-sessions";
import { EngineEventStream } from "../src/engine-event-stream";
import { DEFAULT_WEBHOOK_CLIENT_CONFIG, WebhookClient } from "../src/webhook-client";

const TARGET: EventsTarget = { url: "https://queue.example/v1/engine-events", token: "events-token" };

function fakeLogger() {
  return { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never;
}

/** An api whose db-proxy knows one client, `dash-client` (row id 7), and stores its events target. */
function session() {
  const stored = { eventsUrl: "", eventsToken: "" };
  const db = {
    getClientByClientID: mock(async (clientId: string) =>
      clientId === "dash-client"
        ? { status: { code: "OK" }, client: { id: "7", clientId } }
        : { status: { code: "NOT_FOUND" } }
    ),
    setClientEventsTarget: mock(async (req: { id: string; eventsUrl: string; eventsToken: string }) => {
      stored.eventsUrl = req.eventsUrl;
      stored.eventsToken = req.eventsToken;
      return { status: { code: "OK" } };
    }),
    listClients: mock(async () => ({
      clients: [{ clientId: "dash-client", description: "dash", callbackUrl: "https://cb.example", ...stored }],
    })),
  };
  const logger = fakeLogger();
  const api = new Api({
    db: db as unknown as ApiOptions["db"],
    nats: null,
    functions: null,
    barkloaderUrl: "http://barkloader.local",
    barkloaderKey: "test-barkloader-key-0123456789abcdef",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger,
  });
  const shipped: EventsTarget[] = [];
  const webhooks = new WebhookClient(
    db as never,
    logger,
    new EngineEventStream(logger),
    DEFAULT_WEBHOOK_CLIENT_CONFIG,
    {
      ship: (target) => shipped.push(target),
    }
  );
  api.setWebhookClient(webhooks);
  const rpc = (clientId: string) =>
    new ApiSession(api, clientId, new SessionLease(() => {})) as unknown as Woofx3EngineApi;
  return { db, webhooks, shipped, rpc };
}

describe("setEventsTarget", () => {
  test("stores the calling client's target and ships its next event there", async () => {
    const { db, webhooks, shipped, rpc } = session();

    expect(await rpc("dash-client").setEventsTarget(TARGET)).toEqual({ ok: true });
    await webhooks.send({ type: "workflow.deleted", workflowId: "w1" } as never);

    expect(db.setClientEventsTarget).toHaveBeenCalledWith({
      id: "7",
      eventsUrl: TARGET.url,
      eventsToken: TARGET.token,
    });
    expect(shipped).toEqual([TARGET]);
  });

  test("null clears the target", async () => {
    const { db, rpc } = session();
    await rpc("dash-client").setEventsTarget(TARGET);

    expect(await rpc("dash-client").setEventsTarget(null)).toEqual({ ok: true });

    expect(db.setClientEventsTarget).toHaveBeenLastCalledWith({ id: "7", eventsUrl: "", eventsToken: "" });
  });

  const refused: [string, unknown, string][] = [
    ["a plain http URL to another host", { url: "http://queue.example", token: "t" }, "The events URL is refused"],
    ["an empty token", { url: TARGET.url, token: "" }, "non-empty token"],
    ["a target that is not an object", "https://queue.example", "{ url, token } or null"],
  ];
  for (const [name, target, message] of refused) {
    test(`refuses ${name} without storing it`, async () => {
      const { db, rpc } = session();

      await expect(rpc("dash-client").setEventsTarget(target as EventsTarget)).rejects.toThrow(message);

      expect(db.setClientEventsTarget).not.toHaveBeenCalled();
    });
  }

  test("refuses a client db-proxy does not know", async () => {
    const { db, rpc } = session();

    await expect(rpc("gone-client").setEventsTarget(TARGET)).rejects.toThrow("not found");

    expect(db.setClientEventsTarget).not.toHaveBeenCalled();
  });
});
