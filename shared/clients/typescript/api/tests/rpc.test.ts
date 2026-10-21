import { describe, expect, test } from "bun:test";
import { newMessagePortRpcSession, RpcTarget } from "capnweb";
import {
  AUTHENTICATION_REFUSED,
  authenticationRefusedMessage,
  isAuthenticationRefused,
  isRegistrationRefused,
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
