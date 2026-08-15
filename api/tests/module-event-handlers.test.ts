import { describe, expect, test } from "bun:test";
import {
  initModuleHandlers,
  parseModuleDeleted,
  parseModuleDeleteFailed,
  parseModuleInstalled,
  parseModuleInstallFailed,
  parseModuleTriggerRegistered,
  parseModuleActionRegistered,
  parseModuleWidgetRegistered,
  parseModuleWidgetDeregistered,
} from "../src/module-event-handlers";

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
            taxonomy: ["platform.twitch", "function.chat"],
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
            taxonomy: ["platform.twitch", "function.chat"],
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
            taxonomy: ["platform.twitch"],
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
            output_schema: "[]",
            taxonomy: ["platform.govee", "function.lighting"],
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
            outputSchema: "[]",
            taxonomy: ["platform.govee", "function.lighting"],
            createdByType: "MODULE",
            createdByRef: "twitch:1.0.0:abcdef1",
          },
        ],
      },
    });
  });

  test("degrades a malformed (non-array) taxonomy to an empty array", () => {
    const ce = {
      data: {
        module_key: "k",
        actions: [{ id: "uuid-a", name: "send", taxonomy: "not-an-array" }],
      },
    };
    const result = parseModuleActionRegistered(ce);
    expect(result.event.actions[0]?.taxonomy).toEqual([]);
  });

  test("filters non-string entries out of a taxonomy array", () => {
    const ce = {
      data: {
        module_key: "k",
        actions: [{ id: "uuid-a", name: "send", taxonomy: ["platform.twitch", 42, null] }],
      },
    };
    const result = parseModuleActionRegistered(ce);
    expect(result.event.actions[0]?.taxonomy).toEqual(["platform.twitch"]);
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

describe("parseModuleWidgetRegistered", () => {
  test("maps snake_case NATS payload to camelCase webhook shape", () => {
    const ce = {
      data: {
        module_key: "scene_widgets:1.0.0:abc",
        module_name: "Scene Widgets",
        version: "1.0.0",
        widgets: [
          {
            id: "uuid-w1",
            canonical_id: "scene_widgets:widget:raid_counter",
            projection_key: "scene_widgets:1.0.0:abc:widget:raid_counter",
            manifest_id: "raid_counter",
            name: "Raid Counter",
            description: "Counts incoming raids",
            directory: "widgets/raid_counter",
            alert_types: ["raid"],
            settings: [
              {
                key: "minViewers",
                field_type: "number",
                label: "Minimum viewers",
                default_value: 1,
              },
              {
                key: "tier",
                field_type: "select",
                label: "Display tier",
                default_value: "default",
                options: [
                  { label: "Default", value: "default" },
                  { label: "Big", value: "big" },
                ],
              },
            ],
            created_by_type: "MODULE",
            created_by_ref: "scene_widgets:1.0.0:abc",
          },
        ],
      },
      client_id: "client-x",
    };

    const result = parseModuleWidgetRegistered(ce);

    expect(result).toEqual({
      clientId: "client-x",
      event: {
        type: "module.widget.registered",
        moduleKey: "scene_widgets:1.0.0:abc",
        moduleName: "Scene Widgets",
        version: "1.0.0",
        widgets: [
          {
            id: "uuid-w1",
            canonicalId: "scene_widgets:widget:raid_counter",
            projectionKey: "scene_widgets:1.0.0:abc:widget:raid_counter",
            manifestId: "raid_counter",
            name: "Raid Counter",
            description: "Counts incoming raids",
            directory: "widgets/raid_counter",
            alertTypes: ["raid"],
            settings: [
              {
                key: "minViewers",
                fieldType: "number",
                label: "Minimum viewers",
                defaultValue: 1,
              },
              {
                key: "tier",
                fieldType: "select",
                label: "Display tier",
                defaultValue: "default",
                options: [
                  { label: "Default", value: "default" },
                  { label: "Big", value: "big" },
                ],
              },
            ],
            createdByType: "MODULE",
            createdByRef: "scene_widgets:1.0.0:abc",
          },
        ],
      },
    });
  });

  test("accepts camelCase setting fields as a fallback", () => {
    const ce = {
      data: {
        module_key: "k",
        widgets: [
          {
            id: "uuid-w1",
            manifest_id: "x",
            name: "X",
            directory: "widgets/x",
            alertTypes: ["follow"],
            settings: [
              {
                key: "label",
                fieldType: "text",
                label: "Label",
                defaultValue: "hi",
              },
            ],
          },
        ],
      },
    };
    const result = parseModuleWidgetRegistered(ce);
    expect(result.event.widgets[0]?.alertTypes).toEqual(["follow"]);
    expect(result.event.widgets[0]?.settings[0]).toEqual({
      key: "label",
      fieldType: "text",
      label: "Label",
      defaultValue: "hi",
    });
  });

  test("defaults missing fields to empty values", () => {
    const ce = { data: {} };
    const result = parseModuleWidgetRegistered(ce);
    expect(result.event.moduleKey).toBe("");
    expect(result.event.widgets).toEqual([]);
  });

  test("widget description is omitted when blank", () => {
    const ce = {
      data: {
        module_key: "k",
        widgets: [
          {
            id: "uuid-w1",
            manifest_id: "x",
            name: "X",
            directory: "d",
            alert_types: [],
            settings: [],
          },
        ],
      },
    };
    const result = parseModuleWidgetRegistered(ce);
    expect(result.event.widgets[0]).not.toHaveProperty("description");
  });

  test("settings without options leave the options field unset", () => {
    const ce = {
      data: {
        module_key: "k",
        widgets: [
          {
            id: "w",
            manifest_id: "x",
            name: "X",
            directory: "d",
            alert_types: [],
            settings: [{ key: "k", field_type: "number", label: "L", default_value: 0 }],
          },
        ],
      },
    };
    const result = parseModuleWidgetRegistered(ce);
    expect(result.event.widgets[0]?.settings[0]).not.toHaveProperty("options");
  });
});

describe("parseModuleWidgetDeregistered", () => {
  test("maps full-module-delete payload (carries module_key + name + version)", () => {
    const ce = {
      data: {
        module_key: "scene_widgets:1.0.0:abc",
        module_name: "Scene Widgets",
        version: "1.0.0",
        widgets: [
          {
            id: "uuid-w1",
            canonical_id: "scene_widgets:widget:raid_counter",
            projection_key: "scene_widgets:1.0.0:abc:widget:raid_counter",
            manifest_id: "raid_counter",
            name: "Raid Counter",
            directory: "widgets/raid_counter",
            alert_types: ["raid"],
            settings: [],
            created_by_type: "MODULE",
            created_by_ref: "scene_widgets:1.0.0:abc",
          },
        ],
      },
      client_id: "client-x",
    };

    const result = parseModuleWidgetDeregistered(ce);

    expect(result.clientId).toBe("client-x");
    expect(result.event.type).toBe("module.widget.deregistered");
    expect(result.event.moduleKey).toBe("scene_widgets:1.0.0:abc");
    expect(result.event.moduleName).toBe("Scene Widgets");
    expect(result.event.version).toBe("1.0.0");
    expect(result.event.widgets).toHaveLength(1);
    expect(result.event.widgets[0]?.manifestId).toBe("raid_counter");
    expect(result.event.widgets[0]?.canonicalId).toBe("scene_widgets:widget:raid_counter");
  });
});

describe("parseModuleInstalled", () => {
  test("maps snake_case NATS payload to the ModuleInstalledEvent shape", () => {
    const ce = {
      data: {
        module_name: "Twitch",
        module_key: "twitch:1.0.0:abcdef1",
        version: "1.0.0",
        author: "woofx3",
        taxonomy: ["platform.twitch"],
        description: "Twitch integration",
      },
      client_id: "client-x",
    };

    const result = parseModuleInstalled(ce);

    expect(result.clientId).toBe("client-x");
    expect(result.event.type).toBe("module.installed");
    expect(result.event.moduleName).toBe("Twitch");
    expect(result.event.moduleKey).toBe("twitch:1.0.0:abcdef1");
    expect(result.event.version).toBe("1.0.0");
    expect(result.event.author).toBe("woofx3");
    expect(result.event.taxonomy).toEqual(["platform.twitch"]);
    expect(result.event.description).toBe("Twitch integration");
  });

  test("defaults missing fields to empty string/array", () => {
    const result = parseModuleInstalled({ data: {} });
    expect(result.event.moduleName).toBe("");
    expect(result.event.taxonomy).toEqual([]);
  });
});

describe("parseModuleDeleted", () => {
  test("maps snake_case NATS payload to the ModuleDeletedEvent shape", () => {
    const result = parseModuleDeleted({
      data: { module_name: "Twitch", module_key: "twitch:1.0.0:abcdef1" },
      client_id: "client-x",
    });
    expect(result.clientId).toBe("client-x");
    expect(result.event.type).toBe("module.deleted");
    expect(result.event.moduleName).toBe("Twitch");
    expect(result.event.moduleKey).toBe("twitch:1.0.0:abcdef1");
  });
});

describe("parseModuleDeleteFailed", () => {
  test("maps in_use_resources including nested used_by refs", () => {
    const result = parseModuleDeleteFailed({
      data: {
        module_name: "Twitch",
        module_key: "twitch:1.0.0:abcdef1",
        error: "resource in use",
        in_use_resources: [
          {
            resource_id: "res-1",
            resource_type: "trigger",
            resource_name: "twitch.channel.cheer",
            resource_display_name: "Channel Cheer",
            used_by: [{ source_type: "workflow", source_id: "wf-1", source_name: "My Workflow", context: "trigger" }],
          },
        ],
      },
    });

    expect(result.event.type).toBe("module.delete_failed");
    expect(result.event.error).toBe("resource in use");
    expect(result.event.inUseResources).toHaveLength(1);
    expect(result.event.inUseResources[0]?.resourceDisplayName).toBe("Channel Cheer");
    expect(result.event.inUseResources[0]?.usedBy[0]?.sourceName).toBe("My Workflow");
  });

  test("defaults error to 'Unknown error' when absent", () => {
    const result = parseModuleDeleteFailed({ data: {} });
    expect(result.event.error).toBe("Unknown error");
    expect(result.event.inUseResources).toEqual([]);
  });
});

describe("parseModuleInstallFailed", () => {
  test("maps snake_case NATS payload to the ModuleInstallFailedEvent shape", () => {
    const result = parseModuleInstallFailed({
      data: { module_name: "Twitch", module_key: "twitch:1.0.0:abcdef1", version: "1.0.0", error: "manifest invalid" },
    });
    expect(result.event.type).toBe("module.install_failed");
    expect(result.event.error).toBe("manifest invalid");
  });

  test("defaults error to 'Unknown error' when absent", () => {
    const result = parseModuleInstallFailed({ data: {} });
    expect(result.event.error).toBe("Unknown error");
  });
});

// ---------------------------------------------------------------------------
// initModuleHandlers — end-to-end subscribe -> parse -> webhook wiring,
// same FakeNatsClient/FakeWebhookClient pattern as
// overlay-token-handlers.test.ts.
// ---------------------------------------------------------------------------

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
  withContext: () => noopLogger,
} as any;

class FakeNatsClient {
  private handlers: Map<string, (msg: { data: Uint8Array; subject: string }) => void | Promise<void>> = new Map();

  async subscribe(
    subject: string,
    handler: (msg: { data: Uint8Array; subject: string }) => void | Promise<void>
  ): Promise<void> {
    this.handlers.set(subject, handler);
  }

  async publish(): Promise<void> {}
  async request(): Promise<{ data: Uint8Array; subject: string }> {
    return { data: new Uint8Array(), subject: "" };
  }

  async dispatch(subject: string, data: Record<string, unknown>): Promise<void> {
    for (const [pattern, handler] of this.handlers) {
      if (subjectMatchesPattern(pattern, subject)) {
        // module-event-handlers.ts reads via msg.json(), not
        // TextDecoder(msg.data) — provide both so either style works.
        await handler({ data: new TextEncoder().encode(JSON.stringify(data)), subject, json: () => data } as any);
        return;
      }
    }
    throw new Error(`No handler registered for subject: ${subject}`);
  }
}

function subjectMatchesPattern(pattern: string, subject: string): boolean {
  const patternParts = pattern.split(".");
  const subjectParts = subject.split(".");
  if (patternParts.length !== subjectParts.length) {
    return false;
  }
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] !== "*" && patternParts[i] !== subjectParts[i]) {
      return false;
    }
  }
  return true;
}

class FakeWebhookClient {
  public sentEvents: Array<{ type: string; [key: string]: unknown }> = [];
  async send(event: { type: string; [key: string]: unknown }): Promise<void> {
    this.sentEvents.push(event);
  }
  setApplicationId(): void {}
  async refreshCallbackUrls(): Promise<void> {}
}

describe("initModuleHandlers", () => {
  test("db.module.action.registered.* dispatches to the webhook client", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initModuleHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.module.action.registered.app-1", {
      module_key: "twitch:1.0.0:abc",
      module_name: "Twitch",
      version: "1.0.0",
      actions: [],
    });

    expect(webhook.sentEvents).toHaveLength(1);
    expect(webhook.sentEvents[0]?.type).toBe("module.action.registered");
  });

  test("db.module.installed.* dispatches a ModuleInstalledEvent", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initModuleHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.module.installed.app-1", {
      module_name: "Twitch",
      module_key: "twitch:1.0.0:abc",
      version: "1.0.0",
      author: "woofx3",
    });

    expect(webhook.sentEvents).toHaveLength(1);
    expect(webhook.sentEvents[0]?.type).toBe("module.installed");
    expect(webhook.sentEvents[0]?.moduleName).toBe("Twitch");
  });

  test("db.module.delete_failed.* dispatches a ModuleDeleteFailedEvent with in-use resources", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initModuleHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.module.delete_failed.app-1", {
      module_name: "Twitch",
      module_key: "twitch:1.0.0:abc",
      error: "resource in use",
      in_use_resources: [{ resource_id: "res-1", resource_type: "trigger", resource_name: "twitch.channel.cheer" }],
    });

    expect(webhook.sentEvents).toHaveLength(1);
    const event = webhook.sentEvents[0]!;
    expect(event.type).toBe("module.delete_failed");
    expect((event.inUseResources as unknown[]).length).toBe(1);
  });

  test("db.module.resource.instance.created.* dispatches to the webhook client", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initModuleHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.module.resource.instance.created.app-1", {
      id: "res-1",
      module_id: "mod-1",
      kind: "counter",
      instance_id: "inst-1",
    });

    expect(webhook.sentEvents).toHaveLength(1);
    expect(webhook.sentEvents[0]?.type).toBe("module.resource.instance.created");
  });
});
