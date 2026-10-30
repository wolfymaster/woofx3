import { describe, expect, test } from "bun:test";
import { newMessagePortRpcSession, RpcTarget } from "capnweb";
import {
  AUTHENTICATION_REFUSED,
  authenticationRefusedMessage,
  isAuthenticationRefused,
  isMissingRpcMethod,
  isRegistrationRefused,
  missingRpcMethod,
  refusalReason,
  registrationRefusedMessage,
} from "../rpc";

class RefusingGateway extends RpcTarget {
  async authenticate(): Promise<never> {
    const err = new Error(authenticationRefusedMessage("Invalid client credentials"));
    err.name = AUTHENTICATION_REFUSED;
    throw err;
  }

  async ping(): Promise<never> {
    throw new Error("Engine is restarting");
  }
}

/** The rejection a capnweb client sees when `call` fails on the other end. */
async function rejectionAcrossCapnweb(call: (gateway: RefusingGateway) => Promise<unknown>): Promise<unknown> {
  const channel = new MessageChannel();
  const server = newMessagePortRpcSession(channel.port1, new RefusingGateway());
  const client = newMessagePortRpcSession<RefusingGateway>(channel.port2);
  try {
    return await call(client as unknown as RefusingGateway).then(
      () => null,
      (err: unknown) => err
    );
  } finally {
    client[Symbol.dispose]();
    server[Symbol.dispose]();
    channel.port1.close();
    channel.port2.close();
  }
}

describe("isAuthenticationRefused", () => {
  const cases: { name: string; err: unknown; refused: boolean }[] = [
    { name: "the engine's refusal", err: new Error(authenticationRefusedMessage("bad secret")), refused: true },
    { name: "a plain error", err: new Error("Invalid client credentials"), refused: false },
    { name: "the marker without its separator", err: new Error(AUTHENTICATION_REFUSED), refused: false },
    { name: "a thrown string", err: authenticationRefusedMessage("bad secret"), refused: false },
    { name: "nothing", err: undefined, refused: false },
  ];

  for (const { name, err, refused } of cases) {
    test(`${name} -> ${refused}`, () => {
      expect(isAuthenticationRefused(err)).toBe(refused);
    });
  }

  test("recognises a refusal after capnweb serialisation drops its name", async () => {
    const err = await rejectionAcrossCapnweb((gateway) => gateway.authenticate());

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("Error");
    expect(isAuthenticationRefused(err)).toBe(true);
  });

  test("does not mistake another failure across capnweb for a refusal", async () => {
    const err = await rejectionAcrossCapnweb((gateway) => gateway.ping());

    expect(err).toBeInstanceOf(Error);
    expect(isAuthenticationRefused(err)).toBe(false);
  });
});

describe("isRegistrationRefused", () => {
  const cases: { name: string; err: unknown; refused: boolean }[] = [
    { name: "the engine's refusal", err: new Error(registrationRefusedMessage("token mismatch")), refused: true },
    { name: "an authentication refusal", err: new Error(authenticationRefusedMessage("bad secret")), refused: false },
    { name: "a plain error", err: new Error("This engine requires a registration token"), refused: false },
    { name: "a thrown string", err: registrationRefusedMessage("token mismatch"), refused: false },
  ];

  for (const { name, err, refused } of cases) {
    test(`${name} -> ${refused}`, () => {
      expect(isRegistrationRefused(err)).toBe(refused);
    });
  }

  test("an authentication refusal is not a registration refusal either way round", () => {
    expect(isAuthenticationRefused(new Error(registrationRefusedMessage("x")))).toBe(false);
  });
});

describe("refusalReason", () => {
  const cases: { name: string; err: unknown; reason: string | null }[] = [
    {
      name: "a registration refusal",
      err: new Error(registrationRefusedMessage("This engine requires a registration token to register.")),
      reason: "This engine requires a registration token to register.",
    },
    {
      name: "an authentication refusal",
      err: new Error(authenticationRefusedMessage("Invalid client credentials")),
      reason: "Invalid client credentials",
    },
    { name: "a plain error", err: new Error("fetch failed"), reason: null },
    { name: "a marker without its separator", err: new Error(AUTHENTICATION_REFUSED), reason: null },
    { name: "a thrown string", err: registrationRefusedMessage("nope"), reason: null },
    { name: "nothing", err: undefined, reason: null },
  ];

  for (const { name, err, reason } of cases) {
    test(`${name} -> ${JSON.stringify(reason)}`, () => {
      expect(refusalReason(err)).toBe(reason);
    });
  }

  test("reads a refusal after capnweb serialisation dropped its name", async () => {
    const err = await rejectionAcrossCapnweb((gateway) => gateway.authenticate());

    expect(refusalReason(err)).toBe("Invalid client credentials");
  });
});

describe("missingRpcMethod", () => {
  const cases: { name: string; err: unknown; method: string | null }[] = [
    {
      name: "capnweb's refusal",
      err: new Error("'getEngineCapabilities' is not a function."),
      method: "getEngineCapabilities",
    },
    {
      name: "the refusal without its full stop",
      err: new Error("'listAlerts' is not a function"),
      method: "listAlerts",
    },
    { name: "the refusal as a message string", err: "'getLeaderboard' is not a function.", method: "getLeaderboard" },
    { name: "a dotted method", err: new Error("'twitch.getUsers' is not a function."), method: "twitch.getUsers" },
    { name: "the method failing", err: new Error("getLeaderboard: limit must be a number"), method: null },
    {
      name: "the phrase inside another error",
      err: new Error("Workflow \"'x' is not a function.\" not found"),
      method: null,
    },
    { name: "a method name with a space", err: new Error("'get leaderboard' is not a function."), method: null },
    { name: "an object with a message", err: { message: "'listAlerts' is not a function." }, method: null },
    { name: "nothing", err: undefined, method: null },
  ];

  for (const { name, err, method } of cases) {
    test(`${name} -> ${JSON.stringify(method)}`, () => {
      expect(missingRpcMethod(err)).toBe(method);
    });
  }

  test("reads the refusal capnweb gives a method the target lacks", async () => {
    const err = await rejectionAcrossCapnweb((gateway) =>
      (gateway as unknown as { getEngineCapabilities(): Promise<unknown> }).getEngineCapabilities()
    );

    expect(missingRpcMethod(err)).toBe("getEngineCapabilities");
    expect(isMissingRpcMethod(err, "getEngineCapabilities")).toBe(true);
    expect(isMissingRpcMethod(err, "ping")).toBe(false);
  });

  test("a method that exists and fails is not missing", async () => {
    const err = await rejectionAcrossCapnweb((gateway) => gateway.ping());

    expect(isMissingRpcMethod(err, "ping")).toBe(false);
  });
});
