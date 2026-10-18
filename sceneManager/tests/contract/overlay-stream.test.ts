import { describe, expect, it } from "bun:test";
import {
  ackPath,
  encodeAckBody,
  encodeStreamFrame,
  KEEPALIVE_FRAME,
  parseAckBody,
  parseStreamFrame,
  type StreamFrame,
} from "../../contract/overlay-stream";

describe("encodeStreamFrame and parseStreamFrame", () => {
  const frames: StreamFrame[] = [
    { kind: "hello", bootId: "boot-a", seq: 4, draftSeq: 7 },
    { kind: "delivery", frame: { eventId: "e1", instanceId: "i1", type: "alert", key: "k", value: { n: 1 } } },
    { kind: "module-state", frame: { moduleId: "woofx3", key: "state:woofx3:counter:deaths", value: { value: 3 } } },
    { kind: "scene-ops", event: { seq: 3, ops: [{ p: ["widgets", "w1", "x"], od: 0, oi: 40 }], meta: {} } as never },
    { kind: "cancel", frame: { instanceId: "i1", eventIds: ["e1", "e2"] } },
    { kind: "open-set", frame: { deliveries: { i1: ["e1"], i2: [] } } },
    { kind: "open-set", frame: { deliveries: {} } },
  ];

  it("reads back every frame it writes, as one server-sent event", () => {
    for (const frame of frames) {
      const written = encodeStreamFrame(frame);
      expect(written.endsWith("\n\n")).toBe(true);
      expect(parseStreamFrame(written.trimEnd())).toEqual(frame);
    }
  });

  it("reads the keepalive as nothing", () => {
    expect(parseStreamFrame(KEEPALIVE_FRAME.trimEnd())).toBeNull();
  });
});

describe("parseStreamFrame", () => {
  it("parses a well-formed delivery frame", () => {
    const raw =
      'event: delivery\ndata: {"eventId":"e1","instanceId":"i1","type":"widget.event","key":"count","value":5}';
    expect(parseStreamFrame(raw)).toEqual({
      kind: "delivery",
      frame: { eventId: "e1", instanceId: "i1", type: "widget.event", key: "count", value: 5 },
    });
  });

  it("ignores an event with no name: the scene manager names every frame", () => {
    const raw = 'data: {"eventId":"e1","instanceId":"i1","type":"widget.event","key":"count","value":5}';
    expect(parseStreamFrame(raw)).toBeNull();
  });

  it("parses the hello control frame", () => {
    expect(parseStreamFrame('event: hello\ndata: {"bootId":"boot-a","seq":4,"draftSeq":7}')).toEqual({
      kind: "hello",
      bootId: "boot-a",
      seq: 4,
      draftSeq: 7,
    });
    // A server from before scene ops sends neither.
    expect(parseStreamFrame('event: hello\ndata: {"bootId":"boot-a"}')).toEqual({
      kind: "hello",
      bootId: "boot-a",
      seq: 0,
      draftSeq: 0,
    });
  });

  it("parses a module-state frame", () => {
    const raw =
      'event: module-state\ndata: {"moduleId":"woofx3","key":"state:woofx3:counter:deaths","value":{"value":3}}';
    expect(parseStreamFrame(raw)).toEqual({
      kind: "module-state",
      frame: { moduleId: "woofx3", key: "state:woofx3:counter:deaths", value: { value: 3 } },
    });
  });

  it("parses a scene-ops frame, and drops a malformed one", () => {
    const event = { seq: 3, ops: [{ p: ["widgets", "w1", "x"], od: 0, oi: 40 }], meta: {} };
    expect(parseStreamFrame(`event: scene-ops\ndata: ${JSON.stringify(event)}`)).toEqual({ kind: "scene-ops", event });
    expect(parseStreamFrame('event: scene-ops\ndata: {"seq":"3"}')).toBeNull();
  });

  it("returns null for a module-state frame with no key", () => {
    expect(parseStreamFrame('event: module-state\ndata: {"moduleId":"woofx3","value":1}')).toBeNull();
  });

  it("returns null for a hello frame with no bootId", () => {
    expect(parseStreamFrame("event: hello\ndata: {}")).toBeNull();
  });

  it("returns null for a comment/keepalive line", () => {
    expect(parseStreamFrame(": connected")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseStreamFrame("data: {not json")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseStreamFrame('event: delivery\ndata: {"eventId":"e1"}')).toBeNull();
  });
});

describe("parseStreamFrame: cancel frames", () => {
  it("parses a cancel frame", () => {
    expect(parseStreamFrame('event: cancel\ndata: {"instanceId":"inst-1","eventIds":["evt-1","evt-2"]}')).toEqual({
      kind: "cancel",
      frame: { instanceId: "inst-1", eventIds: ["evt-1", "evt-2"] },
    });
  });

  it("returns null for a cancel frame whose event ids are not all strings", () => {
    expect(parseStreamFrame('event: cancel\ndata: {"instanceId":"inst-1","eventIds":["evt-1",2]}')).toBeNull();
    expect(parseStreamFrame('event: cancel\ndata: {"eventIds":["evt-1"]}')).toBeNull();
  });
});

describe("acks", () => {
  it("are posted to the event's path for their kind", () => {
    expect(ackPath("/scene/s1", "evt 1", "completed")).toBe("/scene/s1/events/evt%201/completed");
  });

  it("carry the placements they acknowledge, and refuse a body naming none", () => {
    expect(parseAckBody(JSON.parse(encodeAckBody(["a", "b"])))).toEqual(["a", "b"]);
    expect(parseAckBody({ instanceIds: [] })).toBeNull();
    expect(parseAckBody({ instanceIds: ["a", ""] })).toBeNull();
    expect(parseAckBody({ instanceIds: ["a", 2] })).toBeNull();
    expect(parseAckBody(null)).toBeNull();
  });
});

describe("parseStreamFrame: open-set frames", () => {
  it("refuses an open set that is not event ids by instance", () => {
    for (const data of ['{"deliveries":[]}', '{"deliveries":{"i1":"e1"}}', '{"deliveries":{"i1":[1]}}', "{}"]) {
      expect(parseStreamFrame(`event: open-set\ndata: ${data}`)).toBeNull();
    }
  });
});
