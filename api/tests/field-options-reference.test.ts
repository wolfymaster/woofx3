import { describe, expect, mock, test } from "bun:test";
import { fieldOptionsDescriptorFor, parseFieldOptionsReference } from "../src/field-options-reference";
import { fieldOptionsRoutes } from "../src/routes/field-options";

const REWARDS_SOURCE = {
  kind: "internal",
  request: { event: "twitchapi", payload: { command: "listChannelPointRewards" } },
  timeoutMs: 10000,
};

const MANIFEST = {
  id: "twitch",
  triggers: [
    {
      id: "channelpoints_redeem",
      schema: [
        { id: "rewardId", label: "Reward", type: "select", source: REWARDS_SOURCE },
        { id: "userName", label: "User", type: "text", source: null },
      ],
    },
  ],
  actions: [
    {
      id: "song_request",
      schema: [
        {
          id: "deviceId",
          label: "Device",
          type: "select",
          source: { kind: "internal", request: { event: "barkloader.module.field_options" } },
        },
      ],
    },
  ],
  widgets: [
    {
      id: "goal",
      settingsSchema: [
        { id: "rewardId", label: "Reward", type: "select", source: { ...REWARDS_SOURCE, timeoutMs: undefined } },
      ],
    },
  ],
  resources: [{ kind: "counter", schema: [{ id: "reward", label: "Reward", type: "select", source: REWARDS_SOURCE }] }],
  settings: [
    { id: "clientId", label: "Client id", type: "text", action: null },
    {
      id: "testConnection",
      label: "Test connection",
      type: "button",
      action: { kind: "internal", request: { event: "twitch.test", payload: {} } },
    },
    { id: "connect", label: "Connect", type: "button", action: { kind: "integration", integration: "twitch" } },
  ],
};

describe("parseFieldOptionsReference", () => {
  test("accepts a reference to a declared item's field, and a module setting without an item", () => {
    expect(
      parseFieldOptionsReference({
        moduleId: "twitch",
        declaration: "trigger",
        declarationId: "channelpoints_redeem",
        fieldId: "rewardId",
      })
    ).toEqual({
      moduleId: "twitch",
      declaration: "trigger",
      declarationId: "channelpoints_redeem",
      fieldId: "rewardId",
    });
    expect(
      parseFieldOptionsReference({ moduleId: "twitch", declaration: "setting", fieldId: "testConnection" })
    ).toEqual({ moduleId: "twitch", declaration: "setting", fieldId: "testConnection" });
  });

  test("refuses a request descriptor, naming the dashboard update", () => {
    expect(() =>
      parseFieldOptionsReference({ kind: "internal", request: { event: "twitchapi", payload: { command: "timeout" } } })
    ).toThrow(/Update the dashboard/);
  });

  test("refuses an incomplete or unknown reference", () => {
    expect(() => parseFieldOptionsReference(null)).toThrow();
    expect(() =>
      parseFieldOptionsReference({ moduleId: "twitch", declaration: "trigger", fieldId: "rewardId" })
    ).toThrow(/declarationId/);
    expect(() =>
      parseFieldOptionsReference({ moduleId: "twitch", declaration: "command", declarationId: "x", fieldId: "y" })
    ).toThrow(/declaration must be one of/);
    expect(() =>
      parseFieldOptionsReference({ moduleId: "twitch", declaration: "setting", declarationId: "x", fieldId: "y" })
    ).toThrow(/no declarationId/);
    expect(() => parseFieldOptionsReference({ moduleId: "", declaration: "setting", fieldId: "y" })).toThrow();
  });
});

describe("fieldOptionsDescriptorFor", () => {
  test("reads a field's source from each kind of declaration", () => {
    const trigger = fieldOptionsDescriptorFor(MANIFEST, {
      moduleId: "twitch",
      declaration: "trigger",
      declarationId: "channelpoints_redeem",
      fieldId: "rewardId",
    });
    expect(trigger).toEqual(REWARDS_SOURCE as typeof trigger);

    const action = fieldOptionsDescriptorFor(MANIFEST, {
      moduleId: "twitch",
      declaration: "action",
      declarationId: "song_request",
      fieldId: "deviceId",
    });
    expect(action).toEqual({ kind: "internal", request: { event: "barkloader.module.field_options" } });

    const widget = fieldOptionsDescriptorFor(MANIFEST, {
      moduleId: "twitch",
      declaration: "widget",
      declarationId: "goal",
      fieldId: "rewardId",
    });
    expect(widget).toEqual({ kind: "internal", request: REWARDS_SOURCE.request });

    const resource = fieldOptionsDescriptorFor(MANIFEST, {
      moduleId: "twitch",
      declaration: "resource",
      declarationId: "counter",
      fieldId: "reward",
    });
    expect(resource.request.event).toBe("twitchapi");
  });

  test("reads a settings button's action", () => {
    expect(
      fieldOptionsDescriptorFor(MANIFEST, { moduleId: "twitch", declaration: "setting", fieldId: "testConnection" })
    ).toEqual({ kind: "internal", request: { event: "twitch.test", payload: {} } });
  });

  test("refuses an undeclared item or field", () => {
    expect(() =>
      fieldOptionsDescriptorFor(MANIFEST, {
        moduleId: "twitch",
        declaration: "action",
        declarationId: "timeout_user",
        fieldId: "rewardId",
      })
    ).toThrow(/declares no action "timeout_user"/);
    expect(() =>
      fieldOptionsDescriptorFor(MANIFEST, {
        moduleId: "twitch",
        declaration: "trigger",
        declarationId: "channelpoints_redeem",
        fieldId: "missing",
      })
    ).toThrow(/no field "missing"/);
  });

  test("refuses a field that declares no internal request", () => {
    for (const fieldId of ["clientId", "connect"]) {
      expect(() =>
        fieldOptionsDescriptorFor(MANIFEST, { moduleId: "twitch", declaration: "setting", fieldId })
      ).toThrow(/declares no internal request/);
    }
    expect(() =>
      fieldOptionsDescriptorFor(MANIFEST, {
        moduleId: "twitch",
        declaration: "trigger",
        declarationId: "channelpoints_redeem",
        fieldId: "userName",
      })
    ).toThrow(/declares no internal request/);
  });
});

type Dispatch = (reference: unknown, correlationKey: string) => Promise<{ dispatched: boolean }>;

/** The route is a mixin over the api's route host; these are all it touches. */
function routeHost() {
  const request = mock(async (_subject: string, _data: Uint8Array, _opts: { timeout: number }) => ({
    data: new TextEncoder().encode(JSON.stringify({ data: [{ value: "r1", label: "Hydrate" }] })),
  }));
  const send = mock(async (_event: Record<string, unknown>) => {});
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const ctx = {
    nats: { request },
    webhookClient: { send },
    logger,
    db: {
      async listModules() {
        return [
          { moduleId: "other", manifest: "{}" },
          { moduleId: "twitch", manifest: JSON.stringify(MANIFEST) },
        ];
      },
    },
  };
  const dispatch = (reference: unknown, correlationKey: string) =>
    (fieldOptionsRoutes.dispatchFieldOptionsRequest as unknown as Dispatch).call(ctx, reference, correlationKey);
  return { dispatch, request, send };
}

describe("dispatchFieldOptionsRequest", () => {
  test("sends the request the stored manifest declares and relays the reply", async () => {
    const { dispatch, request, send } = routeHost();
    const result = await dispatch(
      { moduleId: "twitch", declaration: "trigger", declarationId: "channelpoints_redeem", fieldId: "rewardId" },
      "ck-1"
    );
    expect(result).toEqual({ dispatched: true });
    expect(request).toHaveBeenCalledTimes(1);
    const [subject, bytes, opts] = request.mock.calls[0] as [string, Uint8Array, { timeout: number }];
    expect(subject).toBe("twitchapi");
    expect(opts.timeout).toBe(10000);
    const envelope = JSON.parse(new TextDecoder().decode(bytes));
    expect(envelope.type).toBe("twitchapi");
    expect(envelope.data).toEqual({ command: "listChannelPointRewards" });

    await Bun.sleep(0);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ correlationKey: "ck-1", status: "success", data: [{ value: "r1", label: "Hydrate" }] })
    );
  });

  test("refuses an unknown field without sending anything", async () => {
    const { dispatch, request } = routeHost();
    await expect(
      dispatch({ moduleId: "twitch", declaration: "trigger", declarationId: "channelpoints_redeem", fieldId: "x" }, "k")
    ).rejects.toThrow(/no field "x"/);
    await expect(
      dispatch({ moduleId: "missing", declaration: "setting", fieldId: "testConnection" }, "k")
    ).rejects.toThrow(/not installed/);
    expect(request).not.toHaveBeenCalled();
  });

  test("refuses a client-supplied descriptor without sending anything", async () => {
    const { dispatch, request } = routeHost();
    await expect(
      dispatch({ kind: "internal", request: { event: "twitchapi", payload: { command: "timeout" } } }, "k")
    ).rejects.toThrow(/no longer accepted by descriptor/);
    await expect(
      dispatch(
        {
          moduleId: "twitch",
          declaration: "setting",
          fieldId: "testConnection",
          request: { event: "engine.obs.command", payload: { switch_scene: "BRB" } },
        },
        "k"
      )
    ).rejects.toThrow(/no longer accepted by descriptor/);
    expect(request).not.toHaveBeenCalled();
  });
});
