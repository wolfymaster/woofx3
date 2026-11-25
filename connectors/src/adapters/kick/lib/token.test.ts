import { describe, expect, test } from "bun:test";
import type { KickTokenGrant } from "@woofx3/api/webhooks";
import { TimeoutError } from "@woofx3/nats";
import { FakeTime } from "../../../host/testing";
import { KickTokenClient, type KickTokenRequest } from "./token";

const GRANT: KickTokenGrant = {
  userId: "4242",
  accessToken: "access-1",
  scope: ["chat:write"],
  expiresIn: 7200,
  obtainmentTimestamp: 1_000_000,
  clientId: "kick-app",
};

/** An api that answers each token request with the next reply, recording what was asked. */
function api(...replies: (unknown | Error)[]) {
  const asked: unknown[] = [];
  const request: KickTokenRequest = async (subject, data) => {
    asked.push({ subject, body: JSON.parse(new TextDecoder().decode(data)) });
    const reply = replies.shift();
    if (reply instanceof Error) {
      throw reply;
    }
    return { data: new TextEncoder().encode(typeof reply === "string" ? reply : JSON.stringify(reply)) };
  };
  return { request, asked };
}

function client(request: KickTokenRequest, time = new FakeTime()) {
  return new KickTokenClient({ request, clock: time, timeoutMs: 5000, expiryMarginMs: 60_000 });
}

describe("KickTokenClient", () => {
  const failures: [name: string, reply: unknown | Error, reason: string][] = [
    ["not linked", { token: null, reason: "not_linked", error: "Kick is not linked" }, "not_linked"],
    ["relink required", { token: null, reason: "relink_required", error: "x" }, "relink_required"],
    ["a malformed reply", { token: { userId: "1" } }, "unavailable"],
    ["a non-JSON reply", "nope", "unavailable"],
    ["no answer", new TimeoutError(), "no_answer"],
  ];
  for (const [name, reply, reason] of failures) {
    test(`${name} is a failure with reason ${reason}`, async () => {
      const result = await client(api(reply).request).get();
      expect(result).toMatchObject({ ok: false, failure: { reason } });
    });
  }

  test("asks once and serves the cached token until it is about to expire", async () => {
    const time = new FakeTime();
    const { request, asked } = api({ token: GRANT }, { token: { ...GRANT, accessToken: "access-2" } });
    const tokens = client(request, time);

    expect(await tokens.get()).toEqual({ ok: true, token: GRANT });
    await time.advance(7_200_000 - 60_001);
    expect(await tokens.get()).toEqual({ ok: true, token: GRANT });
    await time.advance(1);
    expect(await tokens.get()).toMatchObject({ ok: true, token: { accessToken: "access-2" } });
    expect(asked).toEqual([
      { subject: "engine.kick.token", body: { force: false } },
      { subject: "engine.kick.token", body: { force: false } },
    ]);
  });

  test("force skips the cache and asks the api to renew", async () => {
    const { request, asked } = api({ token: GRANT }, { token: GRANT });
    const tokens = client(request);
    await tokens.get();
    await tokens.get({ force: true });
    expect(asked).toEqual([
      { subject: "engine.kick.token", body: { force: false } },
      { subject: "engine.kick.token", body: { force: true } },
    ]);
  });

  test("forget drops the cache, as a relink needs", async () => {
    const { request, asked } = api({ token: GRANT }, { token: GRANT });
    const tokens = client(request);
    await tokens.get();
    tokens.forget();
    await tokens.get();
    expect(asked).toHaveLength(2);
  });
});
