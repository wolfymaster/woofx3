import { describe, expect, test } from "bun:test";
import { publicClientIdOf, selectStrategy } from "./token-strategy";

const ENGINE_TOKEN = {
  userId: "42",
  accessToken: "access",
  refreshToken: "refresh",
  scope: ["chat:read"],
  expiresIn: 3600,
  obtainmentTimestamp: 0,
};

describe("selectStrategy", () => {
  test("picks dashboard for a token carrying its issuing app's clientId", () => {
    expect(selectStrategy({ ...ENGINE_TOKEN, refreshToken: null, clientId: "dashboard-app" })).toBe("dashboard");
  });

  test("picks dashboard whatever else the stored token holds", () => {
    expect(selectStrategy({ clientId: "dashboard-app", dashboardClientId: "dash-client" })).toBe("dashboard");
    expect(selectStrategy({ clientId: "dashboard-app" })).toBe("dashboard");
  });

  test("picks engineRefresh for a token without a clientId", () => {
    expect(selectStrategy(ENGINE_TOKEN)).toBe("engineRefresh");
    expect(selectStrategy({})).toBe("engineRefresh");
  });

  test("picks engineRefresh for a blank or non-string clientId", () => {
    expect(selectStrategy({ ...ENGINE_TOKEN, clientId: "" })).toBe("engineRefresh");
    expect(selectStrategy({ ...ENGINE_TOKEN, clientId: null })).toBe("engineRefresh");
    expect(selectStrategy({ ...ENGINE_TOKEN, clientId: 7 })).toBe("engineRefresh");
  });

  test("does not look at dashboardClientId", () => {
    expect(selectStrategy({ ...ENGINE_TOKEN, dashboardClientId: "dash-client" })).toBe("engineRefresh");
  });
});

describe("publicClientIdOf", () => {
  test("names the public app that issued a device login's token", () => {
    expect(publicClientIdOf({ ...ENGINE_TOKEN, publicClientId: "public-app" })).toBe("public-app");
  });

  test("is null for any other token", () => {
    expect(publicClientIdOf(ENGINE_TOKEN)).toBeNull();
    expect(publicClientIdOf({ ...ENGINE_TOKEN, publicClientId: "" })).toBeNull();
    // A dashboard's token is the dashboard's to renew, whatever else it holds.
    expect(publicClientIdOf({ ...ENGINE_TOKEN, clientId: "dashboard-app", publicClientId: "public-app" })).toBeNull();
  });
});
