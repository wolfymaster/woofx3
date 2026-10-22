import { describe, expect, test } from "bun:test";
import {
  manifestFunctions,
  manifestLocalEndpoints,
  manifestOAuthIntegrationIds,
  manifestPermissions,
  manifestResourceKinds,
  manifestSettings,
} from "../module-manifest";

/** Manifests that declare nothing, whatever the reader. */
const DECLARES_NOTHING: { name: string; manifest: unknown }[] = [
  { name: "no manifest", manifest: null },
  { name: "undefined", manifest: undefined },
  { name: "a list", manifest: [] },
  { name: "text", manifest: "manifest.json" },
  { name: "an empty manifest", manifest: {} },
];

describe("manifestPermissions", () => {
  const cases: { name: string; manifest: unknown; permissions: string[] }[] = [
    {
      name: "declared order",
      manifest: { permissions: ["obs.control", "http"] },
      permissions: ["obs.control", "http"],
    },
    {
      name: "duplicates and non-ids dropped",
      manifest: { permissions: ["http", "", 3, null, "http", "obs.control"] },
      permissions: ["http", "obs.control"],
    },
    { name: "a list that is not one", manifest: { permissions: "http" }, permissions: [] },
    ...DECLARES_NOTHING.map(({ name, manifest }) => ({ name, manifest, permissions: [] })),
  ];

  for (const { name, manifest, permissions } of cases) {
    test(name, () => {
      expect(manifestPermissions(manifest)).toEqual(permissions);
    });
  }
});

describe("manifestLocalEndpoints", () => {
  const cases: { name: string; manifest: unknown; endpoints: ReturnType<typeof manifestLocalEndpoints> }[] = [
    {
      name: "an endpoint",
      manifest: { local: [{ id: "obs", name: " OBS WebSocket ", protocol: "websocket", hostSetting: "host" }] },
      endpoints: [{ id: "obs", name: "OBS WebSocket", protocol: "websocket" }],
    },
    {
      name: "no name or protocol",
      manifest: { local: [{ id: "lights" }] },
      endpoints: [{ id: "lights", name: "lights", protocol: "" }],
    },
    {
      name: "the first of each id, entries without one skipped",
      manifest: {
        local: [
          { id: "obs", protocol: "websocket" },
          { id: "obs", protocol: "http" },
          { name: "x" },
          { id: "" },
          "obs",
        ],
      },
      endpoints: [{ id: "obs", name: "obs", protocol: "websocket" }],
    },
    ...DECLARES_NOTHING.map(({ name, manifest }) => ({ name, manifest, endpoints: [] })),
  ];

  for (const { name, manifest, endpoints } of cases) {
    test(name, () => {
      expect(manifestLocalEndpoints(manifest)).toEqual(endpoints);
    });
  }
});

describe("manifestResourceKinds", () => {
  const cases: { name: string; manifest: unknown; kinds: ReturnType<typeof manifestResourceKinds> }[] = [
    {
      name: "a full kind",
      manifest: {
        resources: [
          {
            kind: "counter",
            name: "Counter",
            description: "Counts",
            icon: "hash",
            display: { summary: "value" },
            schema: [{ id: "start", label: "Start", type: "number" }],
          },
        ],
      },
      kinds: [
        {
          kind: "counter",
          name: "Counter",
          description: "Counts",
          icon: "hash",
          summaryPath: "value",
          schema: [{ id: "start", label: "Start", type: "number" }],
        },
      ],
    },
    {
      name: "a bare kind",
      manifest: { resources: [{ kind: "timer", schema: "nope", display: "value" }] },
      kinds: [{ kind: "timer", name: "", description: "", schema: [] }],
    },
    {
      name: "entries without a kind skipped",
      manifest: { resources: [{ name: "No kind" }, { kind: "" }, null, { kind: "queue" }] },
      kinds: [{ kind: "queue", name: "", description: "", schema: [] }],
    },
    ...DECLARES_NOTHING.map(({ name, manifest }) => ({ name, manifest, kinds: [] })),
  ];

  for (const { name, manifest, kinds } of cases) {
    test(name, () => {
      expect(manifestResourceKinds(manifest)).toEqual(kinds);
    });
  }
});

describe("manifestOAuthIntegrationIds", () => {
  const cases: { name: string; manifest: unknown; ids: string[] }[] = [
    { name: "declared ids", manifest: { oauth: [{ id: "spotify" }, { id: "github" }] }, ids: ["spotify", "github"] },
    { name: "entries without an id skipped", manifest: { oauth: [{ id: "" }, { id: 3 }, "spotify"] }, ids: [] },
    ...DECLARES_NOTHING.map(({ name, manifest }) => ({ name, manifest, ids: [] })),
  ];

  for (const { name, manifest, ids } of cases) {
    test(name, () => {
      expect(manifestOAuthIntegrationIds(manifest)).toEqual(ids);
    });
  }
});

describe("manifestSettings", () => {
  const cases: { name: string; manifest: unknown; settings: ReturnType<typeof manifestSettings> }[] = [
    {
      name: "a plain setting, defaults filled in",
      manifest: { settings: [{ id: "host" }] },
      settings: [{ id: "host", label: "", description: "", type: "string", required: false }],
    },
    {
      name: "a full setting with a default written as a number",
      manifest: {
        settings: [
          { id: "port", label: "Port", description: "OBS port", type: "number", required: true, defaultValue: 4455 },
        ],
      },
      settings: [
        { id: "port", label: "Port", description: "OBS port", type: "number", required: true, defaultValue: "4455" },
      ],
    },
    {
      name: "a button connecting a declared integration",
      manifest: {
        oauth: [{ id: "spotify" }],
        settings: [{ id: "connect", type: "button", action: { kind: "integration", integration: "spotify" } }],
      },
      settings: [
        {
          id: "connect",
          label: "",
          description: "",
          type: "button",
          required: false,
          action: { kind: "integration", integration: "spotify", declared: true },
        },
      ],
    },
    {
      name: "a button connecting an undeclared integration",
      manifest: { settings: [{ id: "connect", type: "button", action: { kind: "integration", integration: "x" } }] },
      settings: [
        {
          id: "connect",
          label: "",
          description: "",
          type: "button",
          required: false,
          action: { kind: "integration", integration: "x", declared: false },
        },
      ],
    },
    {
      name: "a button sending an internal request",
      manifest: {
        settings: [
          {
            id: "test",
            type: "button",
            action: { kind: "internal", request: { event: "obs.test", payload: { a: 1 } }, timeoutMs: 5000 },
          },
        ],
      },
      settings: [
        {
          id: "test",
          label: "",
          description: "",
          type: "button",
          required: false,
          action: { kind: "internal", request: { event: "obs.test", payload: { a: 1 } }, timeoutMs: 5000 },
        },
      ],
    },
    {
      name: "unreadable button actions are left off",
      manifest: {
        settings: [
          { id: "a", type: "button", action: { kind: "internal", request: { payload: {} } } },
          { id: "b", type: "button", action: { kind: "teleport" } },
          { id: "c", type: "button", action: "connect" },
        ],
      },
      settings: ["a", "b", "c"].map((id) => ({ id, label: "", description: "", type: "button", required: false })),
    },
    {
      name: "a resource link",
      manifest: { settings: [{ id: "counter", type: "resource_ref", resourceKind: "woofx3:counter" }] },
      settings: [
        {
          id: "counter",
          label: "",
          description: "",
          type: "resource_ref",
          required: false,
          resourceKind: "woofx3:counter",
        },
      ],
    },
    {
      name: "a list keeps only the row fields a row can render",
      manifest: {
        settings: [
          {
            id: "rewards",
            type: "list",
            itemFields: [
              { id: "name", label: "Name", type: "text" },
              { id: "file", label: "File", type: "file" },
              { id: "bad" },
            ],
          },
        ],
      },
      settings: [
        {
          id: "rewards",
          label: "",
          description: "",
          type: "list",
          required: false,
          itemFields: [{ id: "name", label: "Name", type: "text" }],
        },
      ],
    },
    {
      name: "a list with nothing renderable, and a setting with no id, are skipped",
      manifest: {
        settings: [
          { id: "rewards", type: "list", itemFields: [{ id: "file", label: "File", type: "file" }] },
          { id: "empty", type: "list" },
          { label: "No id" },
          null,
        ],
      },
      settings: [],
    },
    ...DECLARES_NOTHING.map(({ name, manifest }) => ({ name, manifest, settings: [] })),
  ];

  for (const { name, manifest, settings } of cases) {
    test(name, () => {
      expect(manifestSettings(manifest)).toEqual(settings);
    });
  }
});

describe("manifestFunctions", () => {
  const cases: { name: string; manifest: unknown; functions: ReturnType<typeof manifestFunctions> }[] = [
    {
      name: "a full function",
      manifest: {
        functions: [
          { id: "battle", name: "Battle", path: "functions/battle.js", entryPoint: "main", runtime: "javascript" },
        ],
      },
      functions: [
        { id: "battle", name: "Battle", path: "functions/battle.js", entryPoint: "main", runtime: "javascript" },
      ],
    },
    {
      name: "blank fields read as absent",
      manifest: { functions: [{ id: "battle", name: " ", path: "", entryPoint: 3 }] },
      functions: [{ id: "battle" }],
    },
    {
      name: "entries without an id skipped",
      manifest: { functions: [{ name: "x" }, { id: "  " }, null, { id: "go" }] },
      functions: [{ id: "go" }],
    },
    ...DECLARES_NOTHING.map(({ name, manifest }) => ({ name, manifest, functions: [] })),
  ];

  for (const { name, manifest, functions } of cases) {
    test(name, () => {
      expect(manifestFunctions(manifest)).toEqual(functions);
    });
  }
});
