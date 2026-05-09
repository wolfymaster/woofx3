import { describe, expect, test } from "bun:test";
import {
  parseModuleTriggerRegistered,
  parseModuleActionRegistered,
  parseModuleWidgetRegistered,
  parseModuleWidgetDeregistered,
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
