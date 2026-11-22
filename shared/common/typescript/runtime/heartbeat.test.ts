import { describe, expect, test } from "bun:test";
import { validateHeartbeatEvent } from "../cloudevents/messages.validate.gen";
import { buildHeartbeat, livenessSubject, readHeartbeat } from "./heartbeat";

const now = new Date("2026-11-19T10:15:30.123Z");

describe("buildHeartbeat", () => {
  test.each([true, false])("builds a message that fits the contract when ready is %p", (ready) => {
    const event = buildHeartbeat("barkloader", ready, now);
    expect(validateHeartbeatEvent(event)).toBe(true);
    expect(event.data).toEqual({ application: "barkloader", ready });
    expect(event.time).toBe("2026-11-19T10:15:30.123Z");
  });

  test("gives each heartbeat its own id", () => {
    expect(buildHeartbeat("db", true, now).id).not.toBe(buildHeartbeat("db", true, now).id);
  });

  test("refuses an empty application name", () => {
    expect(() => buildHeartbeat("", true, now)).toThrow("does not fit its contract");
  });
});

describe("readHeartbeat", () => {
  test("reads what buildHeartbeat builds", () => {
    expect(readHeartbeat(JSON.parse(JSON.stringify(buildHeartbeat("db", true, now))))).toEqual({
      application: "db",
      ready: true,
    });
  });

  test.each([
    ["a bare ping", { ping: true }],
    ["a string", "ping"],
    ["null", null],
    ["a message without an id", { ...buildHeartbeat("db", true, now), id: undefined }],
    ["a stringly ready", { ...buildHeartbeat("db", true, now), data: { application: "db", ready: "true" } }],
    ["data under another name", { ...buildHeartbeat("db", true, now), data: { app: "db", ready: true } }],
  ])("refuses %s", (_name, payload) => {
    expect(readHeartbeat(payload)).toBeUndefined();
  });
});

test("the liveness ping does not use the heartbeat subject", () => {
  expect(livenessSubject("api")).toBe("_HEALTH.api.ping");
});
