import { describe, expect, it } from "bun:test";
import { EngineEventType } from "@woofx3/api/webhooks";
import { parseAlertCreated, parseAlertUpdated } from "./alert-log-handlers";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const ALERT_ID = "22222222-2222-2222-2222-222222222222";
const WORKFLOW_ID = "33333333-3333-3333-3333-333333333333";

function snakeCe(data: Record<string, unknown>) {
  return {
    application_id: APP_ID,
    client_id: "client-1",
    data,
  };
}

describe("parseAlertCreated", () => {
  it("decodes a snake_case row from buildAlertChangeData", () => {
    const ce = snakeCe({
      id: ALERT_ID,
      application_id: APP_ID,
      payload: '{"id":"env-1","parameters":{"widget":"MediaWidget","text":"yo"},"event":null}',
      workflow_id: WORKFLOW_ID,
      source_event_id: "ce-abc",
      status: "sent",
      created_at: "2026-05-03T01:02:03.000Z",
      updated_at: "2026-05-03T01:02:03.000Z",
    });
    const { applicationId, clientId, event } = parseAlertCreated(ce);
    expect(applicationId).toBe(APP_ID);
    expect(clientId).toBe("client-1");
    expect(event?.type).toBe(EngineEventType.ALERT_RECORDED);
    expect(event?.alert.id).toBe(ALERT_ID);
    expect(event?.alert.workflowId).toBe(WORKFLOW_ID);
    expect(event?.alert.sourceEventId).toBe("ce-abc");
    expect(event?.alert.status).toBe("sent");
    expect(event?.alert.payload).toContain("MediaWidget");
    expect(event?.alert.createdAt).toBe("2026-05-03T01:02:03.000Z");
  });

  it("accepts capitalized Go field names", () => {
    const ce = snakeCe({
      ID: ALERT_ID,
      Payload: "{}",
      Status: "sent",
    });
    const { event } = parseAlertCreated(ce);
    expect(event?.alert.id).toBe(ALERT_ID);
  });

  it("returns null when id is missing", () => {
    const ce = snakeCe({ payload: "{}" });
    const { event } = parseAlertCreated(ce);
    expect(event).toBeNull();
  });

  it("defaults status to 'sent' when absent", () => {
    const ce = snakeCe({ id: ALERT_ID, payload: "{}" });
    const { event } = parseAlertCreated(ce);
    expect(event?.alert.status).toBe("sent");
  });
});

describe("parseAlertUpdated", () => {
  it("emits ALERT_REPLAYED for status='replayed'", () => {
    const replayed = snakeCe({
      id: ALERT_ID,
      payload: "{}",
      status: "replayed",
    });
    const { event } = parseAlertUpdated(replayed);
    expect(event?.type).toBe(EngineEventType.ALERT_REPLAYED);
    expect(event?.alert.id).toBe(ALERT_ID);
  });

  it("emits ALERT_COMPLETED for status='completed'", () => {
    const completed = snakeCe({
      id: ALERT_ID,
      payload: "{}",
      status: "completed",
      envelope_id: "env-7",
      played_at: "2026-05-03T01:02:03.000Z",
      completed_at: "2026-05-03T01:02:09.000Z",
    });
    const { event } = parseAlertUpdated(completed);
    expect(event?.type).toBe(EngineEventType.ALERT_COMPLETED);
    expect(event?.alert.envelopeId).toBe("env-7");
    expect(event?.alert.playedAt).toBe("2026-05-03T01:02:03.000Z");
    expect(event?.alert.completedAt).toBe("2026-05-03T01:02:09.000Z");
  });

  it("emits ALERT_FAILED for status='failed' with error", () => {
    const failed = snakeCe({
      id: ALERT_ID,
      payload: "{}",
      status: "failed",
      envelope_id: "env-8",
      error: "autoplay blocked",
      completed_at: "2026-05-03T01:02:09.000Z",
    });
    const { event } = parseAlertUpdated(failed);
    expect(event?.type).toBe(EngineEventType.ALERT_FAILED);
    expect(event?.alert.error).toBe("autoplay blocked");
  });

  it("emits ALERT_TIMED_OUT for status='timed_out'", () => {
    const ce = snakeCe({
      id: ALERT_ID,
      payload: "{}",
      status: "timed_out",
      envelope_id: "env-9",
      error: "lease timeout",
    });
    const { event } = parseAlertUpdated(ce);
    expect(event?.type).toBe(EngineEventType.ALERT_TIMED_OUT);
    expect(event?.alert.error).toBe("lease timeout");
  });

  it("emits ALERT_SKIPPED for status='skipped'", () => {
    const ce = snakeCe({
      id: ALERT_ID,
      payload: "{}",
      status: "skipped",
      envelope_id: "env-10",
    });
    const { event } = parseAlertUpdated(ce);
    expect(event?.type).toBe(EngineEventType.ALERT_SKIPPED);
  });

  it("drops transitions without a webhook surface (e.g. status='playing')", () => {
    const playing = snakeCe({ id: ALERT_ID, payload: "{}", status: "playing" });
    expect(parseAlertUpdated(playing).event).toBeNull();
    const sent = snakeCe({ id: ALERT_ID, payload: "{}", status: "sent" });
    expect(parseAlertUpdated(sent).event).toBeNull();
  });

  it("returns null when id is missing", () => {
    const ce = snakeCe({ payload: "{}", status: "replayed" });
    expect(parseAlertUpdated(ce).event).toBeNull();
  });
});
