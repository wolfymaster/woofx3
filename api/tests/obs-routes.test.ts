import { describe, expect, test } from "bun:test";
import { obsRoutes, parseObsStatusReply } from "../src/routes/obs";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function call(nats: unknown) {
  const route = obsRoutes.getObsStatus as unknown as () => Promise<unknown>;
  return route.call({ nats, logger: fakeLogger() });
}

describe("getObsStatus", () => {
  test("asks the scene manager on engine.obs.status and returns its answer", async () => {
    const asked: string[] = [];
    const nats = {
      async request(subject: string) {
        asked.push(subject);
        const reply = { state: "retrying", failure: "authentication", address: "192.168.1.20:4455" };
        return { data: new TextEncoder().encode(JSON.stringify(reply)) };
      },
    };

    expect(await call(nats)).toEqual({ state: "retrying", failure: "authentication", address: "192.168.1.20:4455" });
    expect(asked).toEqual(["engine.obs.status"]);
  });

  test("reads a scene manager that does not answer as unanswered, not disconnected", async () => {
    const nats = {
      async request() {
        throw new Error("503");
      },
    };

    expect(await call(nats)).toEqual({ state: "unanswered", failure: null, address: null });
  });

  test("is unanswered without a bus", async () => {
    expect(await call(null)).toEqual({ state: "unanswered", failure: null, address: null });
  });
});

describe("parseObsStatusReply", () => {
  test("treats an unknown state as unanswered", () => {
    expect(parseObsStatusReply({ state: "exploded" })).toEqual({ state: "unanswered", failure: null, address: null });
    expect(parseObsStatusReply(null)).toEqual({ state: "unanswered", failure: null, address: null });
  });

  test("drops an unknown failure and an empty address", () => {
    expect(parseObsStatusReply({ state: "connected", failure: "weird", address: "" })).toEqual({
      state: "connected",
      failure: null,
      address: null,
    });
  });

  test("carries the route and a relay failure", () => {
    expect(
      parseObsStatusReply({ state: "retrying", failure: "relay", address: "c-x.woofx3.tv", route: "companion" })
    ).toEqual({ state: "retrying", failure: "relay", address: "c-x.woofx3.tv", route: "companion" });
  });

  test("drops an unknown route", () => {
    expect(parseObsStatusReply({ state: "connected", address: "obs.lan:4455", route: "carrier-pigeon" })).toEqual({
      state: "connected",
      failure: null,
      address: "obs.lan:4455",
    });
  });
});
