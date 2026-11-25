import { describe, expect, test } from "bun:test";
import { TimeoutError } from "@woofx3/nats";
import { KickApiClient } from "./kickapi-client";

/** A bus whose kickapi answers with `reply`, or fails with it when it is an Error. */
function client(reply: unknown | Error) {
  const sent: unknown[] = [];
  const bus = {
    request: async (subject: string, data: Uint8Array) => {
      sent.push({ subject, body: JSON.parse(new TextDecoder().decode(data)) });
      if (reply instanceof Error) {
        throw reply;
      }
      return { subject, data: new TextEncoder().encode(JSON.stringify(reply)) };
    },
  };
  return { sent, kick: new KickApiClient({ bus, timeoutMs: 1000 }) };
}

describe("KickApiClient.findUser", () => {
  test("asks kickapi getUser by the typed name and reads the account", async () => {
    const { sent, kick } = client({
      type: "kickapi.getUser.result",
      data: { userId: "777", login: "pup-pal", displayName: "Pup_Pal" },
    });
    expect(await kick.findUser("Pup_Pal")).toEqual({ ok: true, value: { userId: "777", login: "pup-pal" } });
    expect(sent).toEqual([{ subject: "kickapi", body: { command: "getUser", args: { userName: "Pup_Pal" } } }]);
  });

  const failures: [name: string, reply: unknown | Error, kind: string][] = [
    [
      "a name Kick does not know",
      { type: "kickapi.error", data: { error: "no channel", code: "invalid_arguments" } },
      "missing",
    ],
    ["Kick not linked", { type: "kickapi.error", data: { error: "not linked", code: "not_linked" } }, "unavailable"],
    ["no answer", new TimeoutError(), "unavailable"],
    ["a reply of the wrong shape", { type: "kickapi.getUser.result", data: {} }, "unavailable"],
  ];
  for (const [name, reply, kind] of failures) {
    test(`${name} is ${kind}`, async () => {
      expect(await client(reply).kick.findUser("x")).toMatchObject({ ok: false, failure: { kind } });
    });
  }
});
