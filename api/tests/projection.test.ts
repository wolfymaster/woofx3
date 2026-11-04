import { describe, expect, mock, test } from "bun:test";
import { EngineEventType } from "@woofx3/api/webhooks";
import { EngineEventStream } from "../src/engine-event-stream";
import { subscribeProjections } from "../src/projection";
import { DEFAULT_WEBHOOK_CLIENT_CONFIG, WebhookClient } from "../src/webhook-client";

function fakeLogger() {
  return { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never;
}

/** A bus that keeps each subscription's handler so a test can deliver messages to it. */
function fakeNats() {
  const handlers = new Map<string, (msg: { json(): unknown }) => Promise<void>>();
  return {
    nats: {
      subscribe: mock(async (subject: string, handler: (msg: { json(): unknown }) => Promise<void>) => {
        handlers.set(subject, handler);
      }),
    },
    deliver: (subject: string, ce: unknown) => handlers.get(subject)?.({ json: () => ce }),
  };
}

async function projectedEnvelopeIds(rows: Record<string, unknown>[]): Promise<string[]> {
  const logger = fakeLogger();
  const ids: string[] = [];
  const db = {
    listClients: mock(async () => ({
      clients: [
        {
          clientId: "cloud",
          description: "d",
          callbackUrl: "",
          callbackToken: "",
          eventsUrl: "https://queue.example/v1/engine-events",
          eventsToken: "events-token",
        },
      ],
    })),
  };
  const webhookClient = new WebhookClient(
    db as never,
    logger,
    new EngineEventStream(logger),
    DEFAULT_WEBHOOK_CLIENT_CONFIG,
    { ship: (_target, envelope) => ids.push(envelope.id) }
  );
  await webhookClient.refreshCallbackUrls();
  const { nats, deliver } = fakeNats();
  await subscribeProjections({ nats: nats as never, webhookClient, logger }, [
    {
      subject: "db.workflow.deleted.*",
      name: "workflow.deleted",
      parse: (ce) => ({
        event: { type: EngineEventType.WORKFLOW_DELETED, workflowId: String((ce.data as { id: string }).id) },
      }),
    },
  ]);
  for (const row of rows) {
    await deliver("db.workflow.deleted.*", row);
  }
  return ids;
}

describe("subscribeProjections", () => {
  test("gives a redelivered outbox row the same envelope id, the row's own", async () => {
    const row = { id: "4f8e2b3a-0000-4000-8000-000000000001", data: { id: "w1" } };

    expect(await projectedEnvelopeIds([row, row])).toEqual([row.id, row.id]);
  });

  test("gives a row without an id a fresh envelope id each time", async () => {
    const row = { data: { id: "w1" } };

    const [first, second] = await projectedEnvelopeIds([row, row]);

    expect(first).not.toBe("");
    expect(first).not.toBe(second);
  });
});
