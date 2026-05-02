import { describe, expect, test } from "bun:test";
import {
  parseModuleTriggerRegistered,
  parseModuleActionRegistered,
} from "./module-event-handlers";

describe("parseModuleTriggerRegistered", () => {
  test("maps snake_case NATS payload to camelCase webhook shape", () => {
    const ce = {
      data: {
        module_key: "twitch:1.0.0:abcdef1",
        module_name: "Twitch",
        version: "1.0.0",
        triggers: [
          {
            id: "uuid-1",
            category: "platform.twitch",
            name: "channel.follow",
            description: "desc",
            event: "twitch.channel.follow",
            config_schema: "[]",
            allow_variants: false,
            created_by_type: "MODULE",
            created_by_ref: "twitch:1.0.0:abcdef1",
          },
        ],
      },
      client_id: "client-a",
    };

    const result = parseModuleTriggerRegistered(ce);

    expect(result).toEqual({
      clientId: "client-a",
      event: {
        type: "module.trigger.registered",
        moduleKey: "twitch:1.0.0:abcdef1",
        moduleName: "Twitch",
        version: "1.0.0",
        triggers: [
          {
            id: "uuid-1",
            category: "platform.twitch",
            name: "channel.follow",
            description: "desc",
            event: "twitch.channel.follow",
            configSchema: "[]",
            allowVariants: false,
            createdByType: "MODULE",
            createdByRef: "twitch:1.0.0:abcdef1",
          },
        ],
      },
    });
  });

  test("defaults missing fields to empty values", () => {
    const ce = { data: {} };
    const result = parseModuleTriggerRegistered(ce);
    expect(result.clientId).toBe("");
    expect(result.event.moduleKey).toBe("");
    expect(result.event.moduleName).toBe("");
    expect(result.event.version).toBe("");
    expect(result.event.triggers).toEqual([]);
  });

  test("reads top-level keys if `data` is absent (legacy envelopes)", () => {
    const ce = {
      module_key: "k",
      module_name: "n",
      version: "v",
      triggers: [],
    };
    const result = parseModuleTriggerRegistered(ce);
    expect(result.event.moduleKey).toBe("k");
    expect(result.event.moduleName).toBe("n");
  });

  test("passes projection_key through as projectionKey on each trigger", () => {
    const ce = {
      data: {
        module_key: "twitch:1.0.0:abcdef1",
        module_name: "Twitch",
        version: "1.0.0",
        triggers: [
          {
            id: "uuid-1",
            category: "platform.twitch",
            name: "channel.follow",
            description: "desc",
            event: "twitch.channel.follow",
            config_schema: "[]",
            allow_variants: false,
            created_by_type: "MODULE",
            created_by_ref: "twitch:1.0.0:abcdef1",
            projection_key: "twitch:1.0.0:abcdef1:trigger:channel.follow",
          },
        ],
      },
    };
    const result = parseModuleTriggerRegistered(ce);
    expect(result.event.triggers[0]?.projectionKey).toBe(
      "twitch:1.0.0:abcdef1:trigger:channel.follow"
    );
  });

  test("leaves projectionKey undefined when payload omits projection_key", () => {
    const ce = {
      data: {
        module_key: "k",
        triggers: [{ id: "uuid-1" }],
      },
    };
    const result = parseModuleTriggerRegistered(ce);
    expect(result.event.triggers[0]).not.toHaveProperty("projectionKey");
  });
});

describe("parseModuleActionRegistered", () => {
  test("maps snake_case NATS payload to camelCase webhook shape", () => {
    const ce = {
      data: {
        module_key: "twitch:1.0.0:abcdef1",
        module_name: "Twitch",
        version: "1.0.0",
        actions: [
          {
            id: "uuid-a",
            name: "send",
            description: "desc",
            call: "mod.send",
            params_schema: "{}",
            created_by_type: "MODULE",
            created_by_ref: "twitch:1.0.0:abcdef1",
          },
        ],
      },
      client_id: "client-b",
    };

    const result = parseModuleActionRegistered(ce);

    expect(result).toEqual({
      clientId: "client-b",
      event: {
        type: "module.action.registered",
        moduleKey: "twitch:1.0.0:abcdef1",
        moduleName: "Twitch",
        version: "1.0.0",
        actions: [
          {
            id: "uuid-a",
            name: "send",
            description: "desc",
            call: "mod.send",
            paramsSchema: "{}",
            createdByType: "MODULE",
            createdByRef: "twitch:1.0.0:abcdef1",
          },
        ],
      },
    });
  });

  test("passes projection_key through as projectionKey on each action", () => {
    const ce = {
      data: {
        module_key: "twitch:1.0.0:abcdef1",
        actions: [
          {
            id: "uuid-a",
            name: "send",
            created_by_type: "MODULE",
            created_by_ref: "twitch:1.0.0:abcdef1",
            projection_key: "twitch:1.0.0:abcdef1:action:send",
          },
        ],
      },
    };
    const result = parseModuleActionRegistered(ce);
    expect(result.event.actions[0]?.projectionKey).toBe(
      "twitch:1.0.0:abcdef1:action:send"
    );
  });

  test("leaves projectionKey undefined when payload omits projection_key", () => {
    const ce = {
      data: {
        module_key: "k",
        actions: [{ id: "uuid-a" }],
      },
    };
    const result = parseModuleActionRegistered(ce);
    expect(result.event.actions[0]).not.toHaveProperty("projectionKey");
  });
});
