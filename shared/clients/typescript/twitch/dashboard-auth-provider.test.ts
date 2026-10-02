import { describe, expect, mock, test } from "bun:test";
import {
  DashboardAuthProvider,
  type DashboardToken,
  requestTokenOverNats,
  TWITCH_TOKEN_SUBJECT,
} from "./dashboard-auth-provider";

const NOW = 1_000_000_000_000;

function token(overrides: Partial<DashboardToken> = {}): DashboardToken {
  return {
    userId: "42",
    accessToken: "access-1",
    refreshToken: null,
    scope: ["chat:read"],
    expiresIn: 3600,
    obtainmentTimestamp: NOW,
    clientId: "woofx3-app",
    ...overrides,
  };
}

describe("DashboardAuthProvider", () => {
  test("serves the current token without asking the dashboard while it is valid", async () => {
    const request = mock(async () => token({ accessToken: "access-2" }));
    const provider = new DashboardAuthProvider(token(), request, () => NOW + 1_000);
    expect((await provider.getAccessTokenForUser("42"))?.accessToken).toBe("access-1");
    expect((await provider.getAccessTokenForIntent())?.accessToken).toBe("access-1");
    expect(provider.clientId).toBe("woofx3-app");
    expect(request).not.toHaveBeenCalled();
  });

  test("asks the dashboard for a new token once the current one is about to expire", async () => {
    const request = mock(async () => token({ accessToken: "access-2", obtainmentTimestamp: NOW + 3_600_000 }));
    const provider = new DashboardAuthProvider(token(), request, () => NOW + 3_590_000);
    expect((await provider.getAccessTokenForUser("42"))?.accessToken).toBe("access-2");
    expect(request).toHaveBeenCalledWith(false);
  });

  test("concurrent callers share one request", async () => {
    let resolve: (value: DashboardToken) => void = () => {};
    const request = mock(() => new Promise<DashboardToken>((r) => (resolve = r)));
    const provider = new DashboardAuthProvider(token(), request, () => NOW + 4_000_000);
    const calls = [
      provider.getAnyAccessToken(),
      provider.getAccessTokenForUser({ id: "42" }),
      provider.getAccessTokenForIntent(),
    ];
    resolve(token({ accessToken: "access-2" }));
    const tokens = await Promise.all(calls);
    expect(tokens.map((t) => t?.accessToken)).toEqual(["access-2", "access-2", "access-2"]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("a refresh Twitch asked for forces a new token even before expiry", async () => {
    const request = mock(async () => token({ accessToken: "access-2" }));
    const provider = new DashboardAuthProvider(token(), request, () => NOW);
    expect((await provider.refreshAccessTokenForUser(42)).accessToken).toBe("access-2");
    expect(request).toHaveBeenCalledWith(true);
  });

  test("has no token for any account but the linked one", async () => {
    const request = mock(async () => token());
    const provider = new DashboardAuthProvider(token(), request, () => NOW);
    expect(await provider.getAccessTokenForUser("7")).toBeNull();
    expect(provider.getCurrentScopesForUser("7")).toEqual([]);
    await expect(provider.refreshAccessTokenForUser("7")).rejects.toThrow("only the linked account");
  });

  test("a failed request leaves the next caller free to try again", async () => {
    const request = mock(async () => {
      throw new Error("dashboard unreachable");
    });
    const provider = new DashboardAuthProvider(token(), request, () => NOW + 4_000_000);
    await expect(provider.getAnyAccessToken()).rejects.toThrow("dashboard unreachable");
    await expect(provider.getAnyAccessToken()).rejects.toThrow("dashboard unreachable");
    expect(request).toHaveBeenCalledTimes(2);
  });

  test("replace swaps in a token the dashboard pushed", async () => {
    const provider = new DashboardAuthProvider(
      token(),
      mock(async () => token()),
      () => NOW
    );
    provider.replace(token({ accessToken: "relinked", scope: ["chat:read", "channel:manage:broadcast"] }));
    expect((await provider.getAnyAccessToken()).accessToken).toBe("relinked");
    expect(provider.getCurrentScopesForUser("42")).toEqual(["chat:read", "channel:manage:broadcast"]);
  });
});

describe("requestTokenOverNats", () => {
  const encode = (value: unknown) => ({ data: new TextEncoder().encode(JSON.stringify(value)) });

  test("asks the api service on its subject and returns the token without a refresh token", async () => {
    const request = mock(async (_subject: string, _data: Uint8Array) =>
      encode({
        token: { userId: "42", accessToken: "a", scope: [], expiresIn: 60, obtainmentTimestamp: 1, clientId: "app" },
      })
    );
    const token = await requestTokenOverNats(request)(true);
    expect(token).toEqual({
      userId: "42",
      accessToken: "a",
      scope: [],
      expiresIn: 60,
      obtainmentTimestamp: 1,
      clientId: "app",
      refreshToken: null,
    });
    expect(request.mock.calls[0]?.[0]).toBe(TWITCH_TOKEN_SUBJECT);
    expect(JSON.parse(new TextDecoder().decode(request.mock.calls[0]?.[1]))).toEqual({ force: true });
  });

  test("rejects with the api service's error or a malformed reply", async () => {
    await expect(requestTokenOverNats(async () => encode({ error: "relink_required" }))(false)).rejects.toThrow(
      "relink_required"
    );
    await expect(requestTokenOverNats(async () => encode({ token: { userId: "42" } }))(false)).rejects.toThrow(
      "malformed"
    );
  });
});
