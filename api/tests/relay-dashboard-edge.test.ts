import { describe, expect, mock, test } from "bun:test";
import {
  askDashboardForRelayCredential,
  dashboardClientId,
  type RelayDashboard,
  serveDashboardRelayCredential,
} from "../src/relay-dashboard-edge";

const GRANT = {
  bridgeOrigin: "https://c-abcdefghijkl.woofx3.tv",
  endpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }],
  credential: "wfxr1.k1.eyJ2IjoxfQ.c2ln",
  expiresAt: 1_700_000_300_000,
};

function dashboard(answer: unknown, registered = ["dash-client"]) {
  const request = mock(async (_request: unknown, _clientId: string) => {
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  });
  const value: RelayDashboard = { request, clientIds: () => registered };
  return { request, value };
}

describe("dashboardClientId", () => {
  const cases: Array<[name: string, stored: string, registered: string[], expected: string]> = [
    ["the stored dashboard while it is registered", "a", ["b", "a"], "a"],
    ["the registered dashboard when the stored one registered again", "a", ["b"], "b"],
    ["the stored dashboard when none is registered", "a", [], "a"],
  ];
  for (const [name, stored, registered, expected] of cases) {
    test(`picks ${name}`, () => {
      expect(dashboardClientId(stored, registered)).toBe(expected);
    });
  }
});

describe("askDashboardForRelayCredential", () => {
  test("asks relay.credential.requested of the dashboard that set the configuration", async () => {
    const { request, value } = dashboard({ relay: GRANT });
    expect(await askDashboardForRelayCredential(value, { clientId: "dash-client" })).toEqual({
      status: "answered",
      clientId: "dash-client",
      answer: { relay: GRANT },
    });
    expect(request).toHaveBeenCalledWith({ type: "relay.credential.requested" }, "dash-client");
  });

  test("asks the registered dashboard, and says so, when the stored one registered again", async () => {
    const { request, value } = dashboard({ relay: null }, ["dash-client-2"]);
    expect(await askDashboardForRelayCredential(value, { clientId: "dash-client" })).toEqual({
      status: "answered",
      clientId: "dash-client-2",
      answer: { relay: null },
    });
    expect(request).toHaveBeenCalledWith({ type: "relay.credential.requested" }, "dash-client-2");
  });

  const failures: Array<[name: string, dashboard: RelayDashboard | null, body: unknown, error: string]> = [
    ["an invalid request", dashboard({ relay: GRANT }).value, { clientId: "" }, "invalid request"],
    ["no dashboard connection", null, { clientId: "dash-client" }, "no dashboard connection"],
    ["a dashboard failure", dashboard(new Error("dashboard answered HTTP 503")).value, { clientId: "d" }, "HTTP 503"],
    [
      "a malformed answer",
      dashboard({ relay: { ...GRANT, credential: "bearer x" } }).value,
      { clientId: "d" },
      "malformed",
    ],
    ["an answer with no relay field", dashboard({}).value, { clientId: "d" }, "no relay field"],
  ];
  for (const [name, asked, body, error] of failures) {
    test(`answers failed on ${name}`, async () => {
      const reply = await askDashboardForRelayCredential(asked, body);
      expect(reply.status).toBe("failed");
      expect(reply.status === "failed" ? reply.error : "").toContain(error);
    });
  }
});

describe("serveDashboardRelayCredential", () => {
  async function served(answer: unknown, data: string) {
    let handler: ((msg: unknown) => Promise<void>) | undefined;
    const nats = {
      subscribe: mock(async (subject: string, h: (msg: unknown) => Promise<void>) => {
        expect(subject).toBe("engine.companion.dashboard_credential");
        handler = h;
      }),
    };
    const warn = mock(() => {});
    await serveDashboardRelayCredential(nats as never, () => dashboard(answer).value, { warn } as never);
    const replies: unknown[] = [];
    await handler?.({
      json: () => JSON.parse(data),
      respond: (out: Uint8Array) => replies.push(JSON.parse(new TextDecoder().decode(out))),
    });
    return { replies, warn };
  }

  test("replies with the dashboard's checked answer", async () => {
    const { replies, warn } = await served({ relay: GRANT }, JSON.stringify({ clientId: "dash-client" }));
    expect(replies).toEqual([{ status: "answered", clientId: "dash-client", answer: { relay: GRANT } }]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("replies failed, and warns, to a request that is not JSON", async () => {
    const { replies, warn } = await served({ relay: GRANT }, "{");
    expect(replies).toEqual([{ status: "failed", error: "invalid request: the request must be an object" }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
