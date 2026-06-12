// Protocol type round-trip tests: P1 (`woofx3.widget`) envelope/boot
// guards and P2 (`woofx3.overlay-events`) frames through JSON — both
// protocols travel as structured-cloned postMessage data or JSON
// WebSocket text, so JSON round-trip fidelity is the contract.

import { describe, expect, it } from "bun:test";
import {
  PROTOCOL_VERSION,
  WIDGET_PROTOCOL,
  isWidgetBootPayload,
  isWidgetProtocolEnvelope,
  type WidgetBootPayload,
  type WidgetProtocolMessage,
} from "../src/widget-protocol";
import {
  OVERLAY_EVENTS_PROTOCOL,
  OVERLAY_EVENTS_VERSION,
  isOverlayEventsEnvelope,
  makeOverlayEventsEnvelope,
  type OverlayEventsFrame,
} from "../../api/overlay-events";

function jsonRoundTrip<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("P1 woofx3.widget — envelope guard", () => {
  const messages: WidgetProtocolMessage[] = [
    {
      proto: WIDGET_PROTOCOL,
      v: PROTOCOL_VERSION,
      nonce: "n1",
      type: "hello",
      instanceId: "inst-1",
      sdkVersion: "0.1.0",
      wants: ["storage", "events", "status"],
    },
    {
      proto: WIDGET_PROTOCOL,
      v: PROTOCOL_VERSION,
      nonce: "n1",
      type: "init",
      settings: { label: "x" },
      capabilities: ["storage"],
      acceptedEvents: ["twitch_platform:trigger:follow.user.twitch"],
    },
    {
      proto: WIDGET_PROTOCOL,
      v: PROTOCOL_VERSION,
      nonce: "n1",
      type: "init.reject",
      reason: "unsupported version",
      supportedVersions: [1],
    },
    { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: "n1", type: "storage.get", id: "g1", key: "count" },
    { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: "n1", type: "storage.value", id: "g1", key: "count", value: 7 },
    { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: "n1", type: "storage.subscribe", subId: "s1", key: "count" },
    { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: "n1", type: "storage.unsubscribe", subId: "s1" },
    {
      proto: WIDGET_PROTOCOL,
      v: PROTOCOL_VERSION,
      nonce: "n1",
      type: "storage.changed",
      subId: "s1",
      key: "count",
      value: { n: 8 },
      occurredAt: "2026-06-12T00:00:00Z",
    },
    { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: "n1", type: "events.subscribe", subId: "e1" },
    { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: "n1", type: "events.unsubscribe", subId: "e1" },
    {
      proto: WIDGET_PROTOCOL,
      v: PROTOCOL_VERSION,
      nonce: "n1",
      type: "event.deliver",
      subId: "e1",
      event: {
        type: "twitch_platform:trigger:follow.user.twitch",
        source: "twitch",
        time: "2026-06-12T00:00:00Z",
        data: { userName: "wolfy" },
      },
    },
    {
      proto: WIDGET_PROTOCOL,
      v: PROTOCOL_VERSION,
      nonce: "n1",
      type: "status.report",
      key: "count",
      value: 9,
      ts: "2026-06-12T00:00:00Z",
    },
    { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: "n1", type: "dispose", reason: "scene updated" },
    { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: "n1", type: "ping", ts: 1718150400000 },
    { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: "n1", type: "pong", ts: 1718150400000 },
  ];

  it("every message type survives JSON round-trip and passes the guard", () => {
    for (const message of messages) {
      const decoded = jsonRoundTrip(message);
      expect(isWidgetProtocolEnvelope(decoded)).toBe(true);
      expect(decoded).toEqual(message as unknown as Record<string, unknown>);
    }
  });

  it("rejects wrong proto, wrong version, and missing nonce", () => {
    expect(isWidgetProtocolEnvelope({ proto: "other", v: 1, type: "hello", nonce: "n" })).toBe(false);
    expect(isWidgetProtocolEnvelope({ proto: WIDGET_PROTOCOL, v: 2, type: "hello", nonce: "n" })).toBe(false);
    expect(isWidgetProtocolEnvelope({ proto: WIDGET_PROTOCOL, v: 1, type: "hello" })).toBe(false);
    expect(isWidgetProtocolEnvelope({ proto: WIDGET_PROTOCOL, v: 1, type: "", nonce: "n" })).toBe(false);
    expect(isWidgetProtocolEnvelope(null)).toBe(false);
    expect(isWidgetProtocolEnvelope("hello")).toBe(false);
  });
});

describe("P1 woofx3.widget — boot payload guard", () => {
  const boot: WidgetBootPayload = {
    v: PROTOCOL_VERSION,
    nonce: "n1",
    instanceId: "inst-1",
    moduleId: "mod-1",
    widgetCanonicalId: "mod-1:widget:w1",
    settings: { label: "x" },
    capabilities: ["storage"],
  };

  it("accepts a valid payload (with and without the optional canonical id)", () => {
    expect(isWidgetBootPayload(jsonRoundTrip(boot))).toBe(true);
    const { widgetCanonicalId, ...minimal } = boot;
    expect(isWidgetBootPayload(jsonRoundTrip(minimal))).toBe(true);
  });

  it("rejects missing or mis-typed required fields", () => {
    expect(isWidgetBootPayload({ ...boot, v: 99 })).toBe(false);
    expect(isWidgetBootPayload({ ...boot, nonce: "" })).toBe(false);
    expect(isWidgetBootPayload({ ...boot, instanceId: undefined })).toBe(false);
    expect(isWidgetBootPayload({ ...boot, moduleId: 7 })).toBe(false);
    expect(isWidgetBootPayload({ ...boot, settings: null })).toBe(false);
    expect(isWidgetBootPayload({ ...boot, capabilities: "storage" })).toBe(false);
    expect(isWidgetBootPayload(null)).toBe(false);
  });
});

describe("P2 woofx3.overlay-events — frame round-trip", () => {
  const frames: OverlayEventsFrame[] = [
    {
      kind: "storage",
      id: "evt-1",
      moduleId: "spotify_sr",
      key: "now_playing",
      value: { track: "song" },
      previousValue: null,
      occurredAt: "2026-06-12T00:00:00Z",
    },
    {
      kind: "event",
      type: "twitch_platform:trigger:follow.user.twitch",
      source: "twitch",
      time: "2026-06-12T00:00:00Z",
      data: { userName: "wolfy" },
      parameters: { text: "welcome!", duration: 5 },
    },
    { kind: "scene.updated", sceneId: "scene-1", revision: 4 },
    { kind: "control", action: "token.revoked" },
    { kind: "control", action: "reconnect" },
    { kind: "attach.ready", token: "ovl_abc123" },
    { kind: "attach.ack", v: 1 },
  ];

  it("every frame kind survives JSON round-trip inside the envelope", () => {
    for (const frame of frames) {
      const envelope = makeOverlayEventsEnvelope(frame);
      expect(envelope.proto).toBe(OVERLAY_EVENTS_PROTOCOL);
      expect(envelope.v).toBe(OVERLAY_EVENTS_VERSION);
      const decoded = jsonRoundTrip(envelope);
      expect(isOverlayEventsEnvelope(decoded)).toBe(true);
      expect(decoded).toEqual(envelope as unknown as Record<string, unknown>);
    }
  });

  it("rejects wrong proto / version / unknown frame kind / missing frame", () => {
    const good = makeOverlayEventsEnvelope({ kind: "control", action: "reconnect" });
    expect(isOverlayEventsEnvelope({ ...good, proto: "woofx3.widget" })).toBe(false);
    expect(isOverlayEventsEnvelope({ ...good, v: 2 })).toBe(false);
    expect(isOverlayEventsEnvelope({ ...good, frame: { kind: "mystery" } })).toBe(false);
    expect(isOverlayEventsEnvelope({ ...good, frame: null })).toBe(false);
    expect(isOverlayEventsEnvelope({ proto: OVERLAY_EVENTS_PROTOCOL, v: 1 })).toBe(false);
    expect(isOverlayEventsEnvelope(null)).toBe(false);
  });
});
