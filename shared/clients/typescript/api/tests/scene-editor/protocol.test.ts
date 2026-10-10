import { describe, expect, test } from "bun:test";
import {
  type ClientMessage,
  decodeClientMessage,
  decodeServerMessage,
  NACK_RETRYABLE,
  parseClientMessage,
  parseServerMessage,
  type ServerMessage,
} from "../../scene-editor/protocol";
import { placement, sceneDoc } from "./test-support";

const doc = sceneDoc({ w: placement() });

const validClient: ClientMessage[] = [
  { type: "hello", protocol: 2, clientId: "c1", have: null, name: "Pat" },
  { type: "hello", protocol: 2, clientId: "c1", have: { v: 4, id: "e.4" }, name: "Pat" },
  { type: "item", seq: 1, base: 0, body: { kind: "edit", version: "draft", ops: [{ p: ["layout", "a"], oi: 1 }] } },
  { type: "item", seq: 2, base: 3, body: { kind: "publish" } },
  { type: "item", seq: 3, base: 3, body: { kind: "discard" } },
  { type: "presence", selection: "w", version: "published" },
  { type: "presence", selection: null, version: "draft" },
  { type: "presence", away: true },
];

const validServer: ServerMessage[] = [
  { type: "welcome", protocol: 2, features: [], clientId: "c1", last: null, catchup: [] },
  {
    type: "welcome",
    protocol: 2,
    features: ["x"],
    clientId: "c1",
    last: { seq: 2, outcome: "rejected", code: "invalid" },
    snapshot: {
      v: 3,
      id: "e.3",
      docs: { draft: doc, published: doc },
      meta: { draft: {}, published: {} },
      hasDraft: false,
      name: "S",
    },
    diverged: true,
  },
  {
    type: "entry",
    v: 1,
    id: "e.1",
    src: { clientId: "c1", seq: 1 },
    kind: "edit",
    changes: { draft: [{ p: ["layout", "a"], oi: 1 }] },
    meta: { draft: { w: null } },
    hasDraft: true,
  },
  { type: "ack", seq: 1, v: 0 },
  { type: "nack", seq: 1, code: "unavailable", retryable: true, detail: "" },
  { type: "presence", clientId: "c2", name: "Sam", selection: null, version: "draft" },
  { type: "presence", clientId: "c2", left: true },
  { type: "error", code: "not_found", detail: "gone" },
];

describe("protocol parsers", () => {
  test("every valid message parses back to itself", () => {
    for (const message of validClient) {
      expect(decodeClientMessage(JSON.stringify(message))).toEqual(message);
    }
    for (const message of validServer) {
      expect(decodeServerMessage(JSON.stringify(message))).toEqual(message);
    }
  });

  test("malformed client messages are refused", () => {
    for (const value of [
      null,
      "hello",
      { type: "hello", protocol: 1, clientId: "c", have: null, name: "" },
      { type: "hello", protocol: 2, clientId: "", have: null, name: "" },
      { type: "hello", protocol: 2, clientId: "c", have: { v: -1, id: "" }, name: "" },
      { type: "item", seq: 0, base: 0, body: { kind: "publish" } },
      { type: "item", seq: 1.5, base: 0, body: { kind: "publish" } },
      { type: "item", seq: 1, base: 0, body: { kind: "edit", version: "staging", ops: [] } },
      { type: "item", seq: 1, base: 0, body: { kind: "edit", version: "draft" } },
      { type: "item", seq: 1, base: 0, body: { kind: "rename" } },
      { type: "presence", selection: 3, version: "draft" },
      { type: "nope" },
    ]) {
      expect(parseClientMessage(value)).toBeNull();
    }
    expect(decodeClientMessage("{")).toBeNull();
  });

  test("malformed server messages are refused", () => {
    for (const value of [
      { type: "welcome", protocol: 2, features: [], clientId: "c", last: null },
      { ...validServer[1], catchup: [] },
      {
        type: "welcome",
        protocol: 2,
        features: [],
        clientId: "c",
        last: { seq: 1, outcome: "applied", code: "invalid" },
        catchup: [],
      },
      { type: "entry", v: 0, id: "e.0", src: null, kind: "edit", changes: {}, meta: {}, hasDraft: false },
      { type: "entry", v: 1, id: "e.1", src: null, kind: "edit", changes: { staging: [] }, meta: {}, hasDraft: false },
      { type: "nack", seq: 1, code: "invalid", retryable: true, detail: "" },
      { type: "nack", seq: 1, code: "bogus", retryable: false, detail: "" },
      { type: "error", code: "teapot", detail: "" },
    ]) {
      expect(parseServerMessage(value)).toBeNull();
    }
  });

  test("only invalid is a terminal refusal", () => {
    expect(NACK_RETRYABLE).toEqual({ invalid: false, stale_base: true, unavailable: true });
  });
});
