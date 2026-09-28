import { describe, expect, it, mock } from "bun:test";
import type { ConfigBundle, Woofx3EngineApi } from "@woofx3/api";
import { Api, type ApiOptions } from "../src/api";
import { ApiSession } from "../src/api-session";
import { MAX_CONFIG_BUNDLE_BYTES } from "../src/config-bundle/schema";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

const COUNTER_MANIFEST = JSON.stringify({ id: "counter", resources: [{ kind: "counter" }] });

interface ModuleSpec {
  moduleId: string;
  version: string;
  manifest?: string;
}

/**
 * An in-memory db-proxy holding the rows a config bundle covers. The reads
 * that could reach a secret throw, so any export path that touched one fails
 * the test rather than merely leaking quietly.
 */
class FakeEngineDb {
  private seq = 0;
  workflows: any[] = [];
  commands: any[] = [];
  groups: any[] = [{ id: "g-builtin-mods", name: "Moderators", description: "Built in", isBuiltIn: true }];
  members = new Map<string, string[]>();
  instances: any[] = [];
  modules: ModuleSpec[] = [
    { moduleId: "woofx3", version: "1.0.0" },
    { moduleId: "counter", version: "2.0.0", manifest: COUNTER_MANIFEST },
  ];
  actions: any[] = [
    { manifestId: "chat.reply", createdByType: "MODULE", createdByRef: "woofx3" },
    { manifestId: "function", createdByType: "MODULE", createdByRef: "woofx3" },
  ];
  triggers: any[] = [{ event: "channel.follow", createdByType: "MODULE", createdByRef: "woofx3:1.0.0:abc" }];

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  async listWorkflows(req: { page: number; pageSize: number }) {
    const start = (req.page - 1) * req.pageSize;
    return {
      workflows: this.workflows.slice(start, start + req.pageSize),
      totalCount: this.workflows.length,
      page: req.page,
      pageSize: req.pageSize,
    };
  }
  async findWorkflow(req: { id: string }) {
    return this.workflows.find((w) => w.id === req.id) ?? null;
  }
  async getWorkflow(req: { id: string }) {
    const found = this.workflows.find((w) => w.id === req.id);
    if (!found) {
      throw new Error(`no workflow ${req.id}`);
    }
    return found;
  }
  async createWorkflow(req: any) {
    const row = { ...req, id: this.id("wf"), createdByType: req.createdByType || "USER" };
    this.workflows.push(row);
    return row;
  }
  async updateWorkflow(req: any) {
    const row = this.workflows.find((w) => w.id === req.id);
    Object.assign(row, req);
    return row;
  }

  async listCommands() {
    return this.commands;
  }
  async createCommand(req: any) {
    const row = { ...req, id: this.id("cmd"), createdByType: req.createdByType || "USER" };
    this.commands.push(row);
    return row;
  }
  async updateCommand(req: any) {
    const row = this.commands.find((c) => c.id === req.id);
    Object.assign(row, req);
    return row;
  }

  async listGroups() {
    return this.groups;
  }
  async createGroup(req: { name: string; description: string }) {
    const row = { id: this.id("g"), name: req.name, description: req.description, isBuiltIn: false };
    this.groups.push(row);
    return row;
  }
  async updateGroup(req: { id: string; name: string; description: string }) {
    const row = this.groups.find((g) => g.id === req.id);
    Object.assign(row, { name: req.name, description: req.description });
    return row;
  }
  async listGroupMembers(req: { groupId: string }) {
    return this.members.get(req.groupId) ?? [];
  }
  async addUserToGroup(req: { groupId: string; username: string }) {
    this.members.set(req.groupId, [...(this.members.get(req.groupId) ?? []), req.username]);
    return { code: "OK", message: "" };
  }

  async listAllResourceInstances() {
    return { instances: this.instances };
  }
  async createResourceInstance(req: any) {
    const instance = {
      id: this.id("ri"),
      moduleId: "",
      moduleName: req.moduleName,
      kind: req.kind,
      instanceId: req.instanceId,
      displayName: req.displayName,
      canonicalId: `${req.moduleName}:${req.kind}:${req.instanceId}`,
      moduleKey: "",
      settingsJson: req.settingsJson,
    };
    this.instances.push(instance);
    return { instance };
  }
  async updateResourceInstance(req: any) {
    const instance = this.instances.find((i) => i.canonicalId === req.canonicalId);
    Object.assign(instance, { displayName: req.displayName, settingsJson: req.settingsJson });
    return { instance };
  }

  async listModules() {
    return this.modules.map((m) => ({ id: `uuid-${m.moduleId}`, ...m, manifest: m.manifest ?? "{}" }));
  }
  async listActions() {
    return this.actions;
  }
  async listTriggers() {
    return this.triggers;
  }

  async getSetting(): Promise<never> {
    throw new Error("config export must not read settings");
  }
  async listSettings(): Promise<never> {
    throw new Error("config export must not read settings");
  }
  async listModuleSettings(): Promise<never> {
    throw new Error("config export must not read module settings");
  }
  async listOverlayTokens(): Promise<never> {
    throw new Error("config export must not read overlay tokens");
  }
  async listClients(): Promise<never> {
    throw new Error("config export must not read API clients");
  }
}

function makeApi(db: FakeEngineDb) {
  const published: string[] = [];
  const api = new Api({
    db: db as unknown as ApiOptions["db"],
    nats: { publish: mock((subject: string) => published.push(subject)) } as unknown as ApiOptions["nats"],
    functions: null,
    barkloaderUrl: "http://barkloader.local",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger: fakeLogger(),
    version: "1.4.0",
  });
  // The contract methods are installed on the session's prototype at load
  // time, so its class type does not list them; a client sees this interface.
  const session = new ApiSession(api, "client-1") as unknown as Woofx3EngineApi;
  return { api, session, published };
}

function workflowRow(db: FakeEngineDb, fields: Record<string, unknown>) {
  const row = {
    id: `src-wf-${db.workflows.length + 1}`,
    description: "",
    enabled: true,
    createdByType: "USER",
    triggerJson: JSON.stringify({ type: "event", event: "channel.follow" }),
    stepsJson: JSON.stringify([{ id: "say", type: "action", action: "chat.reply", parameters: { message: "hi" } }]),
    ...fields,
  };
  db.workflows.push(row);
  return row;
}

/** A source engine with one of everything a bundle carries, and some things it must not. */
function populatedEngine(): FakeEngineDb {
  const db = new FakeEngineDb();

  db.groups.push({ id: "src-g-vip", name: "VIPs", description: "Trusted chatters", isBuiltIn: false });
  db.members.set("src-g-vip", ["alice", "bob"]);

  const child = workflowRow(db, { name: "Thank follower", enabled: false });
  workflowRow(db, {
    name: "Follow hype",
    stepsJson: JSON.stringify([
      {
        id: "bump",
        type: "action",
        action: "function",
        parameters: { function: "counter:function:increment", counter: "counter:counter:follows" },
      },
      { id: "thank", type: "workflow", dependsOn: ["bump"], workflow: { workflowId: child.id } },
    ]),
  });
  workflowRow(db, { name: "Module shoutout", createdByType: "MODULE", createdByRef: "counter" });

  db.commands.push(
    {
      id: "src-cmd-1",
      command: "vanish",
      cooldown: 30,
      priority: 1,
      enabled: true,
      visibility: "restricted",
      groupIds: ["src-g-vip", "g-builtin-mods"],
      usernames: ["carol"],
      argumentPattern: "{target}",
      actionsJson: JSON.stringify([
        { action: "chat.reply", parameters: { message: "poof ${trigger.data.variables.target}" } },
      ]),
      createdByType: "USER",
    },
    {
      id: "src-cmd-2",
      command: "modcmd",
      cooldown: 0,
      priority: 0,
      enabled: true,
      visibility: "public",
      groupIds: [],
      usernames: [],
      argumentPattern: "",
      actionsJson: "[]",
      createdByType: "MODULE",
    }
  );

  db.instances.push({
    id: "src-ri-1",
    moduleName: "counter",
    kind: "counter",
    instanceId: "follows",
    displayName: "Follows",
    canonicalId: "counter:counter:follows",
    moduleKey: "counter:2.0.0:abc",
    settingsJson: JSON.stringify({ step: 1, lifetime: "forever", initialValue: 0 }),
  });

  return db;
}

/** An engine as a fresh install leaves it: modules and built-in groups, nothing authored. */
function emptyEngine(): FakeEngineDb {
  return new FakeEngineDb();
}

function withoutTimestamp(bundle: ConfigBundle): Omit<ConfigBundle, "exportedAt"> {
  const { exportedAt: _exportedAt, ...rest } = bundle;
  return rest;
}

describe("exportConfig", () => {
  it("exports only what the creator authored, addressed by name, with no ids", async () => {
    const { api } = makeApi(populatedEngine());

    const bundle = await api.exportConfig();

    expect(bundle.format).toBe("woofx3.config");
    expect(bundle.version).toBe(1);
    expect(bundle.engineVersion).toBe("1.4.0");
    expect(bundle.includeMembers).toBe(false);
    expect(bundle.workflows.map((w) => w.name)).toEqual(["Follow hype", "Thank follower"]);
    expect(bundle.commands.map((c) => c.command)).toEqual(["vanish"]);
    expect(bundle.groups).toEqual([{ description: "Trusted chatters", name: "VIPs" }]);
    expect(bundle.resources).toEqual([
      {
        displayName: "Follows",
        instanceId: "follows",
        kind: "counter",
        module: "counter",
        requires: ["counter"],
        settings: { initialValue: 0, lifetime: "forever", step: 1 },
      },
    ]);

    const hype = bundle.workflows[0];
    expect(hype.workflowRefs).toEqual({ thank: "Thank follower" });
    expect(hype.definition.tasks[1].workflow?.workflowId).toBe("");
    expect(JSON.stringify(bundle)).not.toContain("src-");
  });

  it("carries group grants by name and leaves usernames out by default", async () => {
    const { api } = makeApi(populatedEngine());

    const bundle = await api.exportConfig();

    expect(bundle.commands[0].groups).toEqual(["Moderators", "VIPs"]);
    expect(bundle.commands[0].usernames).toBeUndefined();
    expect(bundle.groups[0].members).toBeUndefined();
    const text = JSON.stringify(bundle);
    for (const person of ["alice", "bob", "carol"]) {
      expect(text).not.toContain(person);
    }
  });

  it("includes members and usernames only when asked", async () => {
    const { api } = makeApi(populatedEngine());

    const bundle = await api.exportConfig({ includeMembers: true });

    expect(bundle.includeMembers).toBe(true);
    expect(bundle.groups[0].members).toEqual(["alice", "bob"]);
    expect(bundle.commands[0].usernames).toEqual(["carol"]);
  });

  it("lists the modules the bundle references, with the versions it was exported from", async () => {
    const { api } = makeApi(populatedEngine());

    const bundle = await api.exportConfig();

    expect(bundle.requires).toEqual([
      { moduleId: "counter", version: "2.0.0" },
      { moduleId: "woofx3", version: "1.0.0" },
    ]);
    expect(bundle.workflows[0].requires).toEqual(["counter", "woofx3"]);
    expect(bundle.workflows[1].requires).toEqual(["woofx3"]);
    expect(bundle.commands[0].requires).toEqual(["woofx3"]);
  });

  it("never reads settings, module settings, overlay tokens or clients", async () => {
    // Each of those reads throws on the fake, so reaching one fails the export.
    const { api } = makeApi(populatedEngine());

    await expect(api.exportConfig({ include: undefined, includeMembers: true })).resolves.toBeDefined();
  });

  it("exports only the sections asked for", async () => {
    const { api } = makeApi(populatedEngine());

    const bundle = await api.exportConfig({ include: ["groups"] });

    expect(bundle.groups).toHaveLength(1);
    expect(bundle.workflows).toEqual([]);
    expect(bundle.commands).toEqual([]);
    expect(bundle.resources).toEqual([]);
    expect(bundle.requires).toEqual([]);
  });

  it("is byte-for-byte stable apart from its timestamp", async () => {
    const { api } = makeApi(populatedEngine());

    const first = await api.exportConfig({ includeMembers: true });
    const second = await api.exportConfig({ includeMembers: true });

    expect(JSON.stringify(withoutTimestamp(first))).toBe(JSON.stringify(withoutTimestamp(second)));
  });

  it("rejects an unknown section", async () => {
    const { api } = makeApi(populatedEngine());

    await expect(api.exportConfig({ include: ["scenes" as never] })).rejects.toThrow(/unknown section/);
  });
});

describe("round trip into an empty engine", () => {
  it("recreates the setup, and exporting it again gives the same bundle", async () => {
    const { api: source } = makeApi(populatedEngine());
    const bundle = await source.exportConfig({ includeMembers: true });

    const target = emptyEngine();
    const { session, published } = makeApi(target);
    const preview = await session.previewImport(bundle);
    expect(preview.summary).toEqual({ create: 5, update: 0, skip: 0, conflict: 0 });
    expect(preview.items.map((i) => `${i.kind}:${i.key}:${i.action}`)).toEqual([
      "group:VIPs:create",
      "resource:counter:counter:follows:create",
      "workflow:Thank follower:create",
      "workflow:Follow hype:create",
      "command:vanish:create",
    ]);

    const result = await session.importConfig(bundle);

    expect(result.summary).toEqual({ created: 5, updated: 0, skipped: 0, conflict: 0, failed: 0 });
    expect(published).toContain("command.created");
    const hype = target.workflows.find((w) => w.name === "Follow hype");
    const thank = target.workflows.find((w) => w.name === "Thank follower");
    expect(JSON.parse(hype.stepsJson)[1].workflow.workflowId).toBe(thank.id);
    expect(hype.enabled).toBe(true);
    expect(thank.enabled).toBe(false);
    const vip = target.groups.find((g) => g.name === "VIPs");
    expect(target.members.get(vip.id)).toEqual(["alice", "bob"]);
    expect(target.commands[0].groupIds.sort()).toEqual(["g-builtin-mods", vip.id].sort());

    const again = await makeApi(target).api.exportConfig({ includeMembers: true });
    expect(withoutTimestamp(again)).toEqual(withoutTimestamp(bundle));
  });

  it("is idempotent: importing the same bundle twice changes nothing the second time", async () => {
    const { api: source } = makeApi(populatedEngine());
    const bundle = await source.exportConfig({ includeMembers: true });
    const target = emptyEngine();
    const { session } = makeApi(target);
    await session.importConfig(bundle);
    const rowsAfterFirst = JSON.stringify([target.workflows, target.commands, target.groups, target.instances]);

    const second = await session.importConfig(bundle, { onConflict: "rename" });

    expect(second.summary).toEqual({ created: 0, updated: 0, skipped: 5, conflict: 0, failed: 0 });
    expect(JSON.stringify([target.workflows, target.commands, target.groups, target.instances])).toBe(rowsAfterFirst);
  });

  it("imports a bundle given as the file's raw text", async () => {
    const { api: source } = makeApi(populatedEngine());
    const text = JSON.stringify(await source.exportConfig());
    const { session } = makeApi(emptyEngine());

    const plan = await session.previewImport(text as unknown as ConfigBundle);

    expect(plan.summary.create).toBe(5);
  });
});

describe("conflicts", () => {
  async function bundleWith(mutate: (db: FakeEngineDb) => void = () => {}) {
    const db = populatedEngine();
    mutate(db);
    return makeApi(db).api.exportConfig();
  }

  function engineWithDifferentFollowHype(): FakeEngineDb {
    const db = emptyEngine();
    db.workflows.push({
      id: "t-wf-1",
      name: "Follow hype",
      description: "mine",
      enabled: false,
      createdByType: "USER",
      triggerJson: JSON.stringify({ type: "event", event: "channel.raid" }),
      stepsJson: JSON.stringify([{ id: "x", type: "log" }]),
    });
    return db;
  }

  it("leaves a differing item with a taken name as a conflict under skip", async () => {
    const bundle = await bundleWith();
    const { session } = makeApi(engineWithDifferentFollowHype());

    const plan = await session.previewImport(bundle, { include: ["workflows"] });

    const item = plan.items.find((i) => i.key === "Follow hype");
    expect(item?.action).toBe("conflict");
    expect(item?.reasons.map((r) => r.code)).toContain("name_collision");
  });

  it("imports it under a free name with rename", async () => {
    const bundle = await bundleWith();
    const target = engineWithDifferentFollowHype();
    const { session } = makeApi(target);

    const plan = await session.previewImport(bundle, { include: ["workflows"], onConflict: "rename" });
    const item = plan.items.find((i) => i.key === "Follow hype");
    expect(item).toMatchObject({ action: "create", targetName: "Follow hype (imported)" });

    await session.importConfig(bundle, { include: ["workflows"], onConflict: "rename" });
    expect(target.workflows.map((w) => w.name).sort()).toEqual([
      "Follow hype",
      "Follow hype (imported)",
      "Thank follower",
    ]);
    expect(target.workflows.find((w) => w.id === "t-wf-1").description).toBe("mine");
  });

  it("replaces it with overwrite", async () => {
    const bundle = await bundleWith();
    const target = engineWithDifferentFollowHype();
    const { session } = makeApi(target);

    const plan = await session.previewImport(bundle, { include: ["workflows"], onConflict: "overwrite" });
    expect(plan.items.find((i) => i.key === "Follow hype")).toMatchObject({ action: "update", targetId: "t-wf-1" });

    const result = await session.importConfig(bundle, { include: ["workflows"], onConflict: "overwrite" });

    expect(result.items.find((i) => i.key === "Follow hype")).toMatchObject({ outcome: "updated", id: "t-wf-1" });
    const row = target.workflows.find((w) => w.id === "t-wf-1");
    expect(JSON.parse(row.triggerJson)).toEqual({ event: "channel.follow", type: "event" });
    expect(row.enabled).toBe(true);
  });

  it("never overwrites what a module owns", async () => {
    const bundle = await bundleWith();
    const target = engineWithDifferentFollowHype();
    target.workflows[0].createdByType = "MODULE";
    const { session } = makeApi(target);

    const plan = await session.previewImport(bundle, { include: ["workflows"], onConflict: "overwrite" });

    const item = plan.items.find((i) => i.key === "Follow hype");
    expect(item?.action).toBe("conflict");
    expect(item?.reasons.map((r) => r.code)).toContain("not_owned");
  });

  it("keeps an overwritten command's usernames when the bundle carries none", async () => {
    const bundle = await bundleWith();
    const target = emptyEngine();
    target.commands.push({
      id: "t-cmd-1",
      command: "Vanish",
      cooldown: 0,
      priority: 0,
      enabled: false,
      visibility: "restricted",
      groupIds: [],
      usernames: ["dave"],
      argumentPattern: "",
      actionsJson: "[]",
      createdByType: "USER",
    });
    const { session } = makeApi(target);

    await session.importConfig(bundle, { onConflict: "overwrite" });

    expect(target.commands).toHaveLength(1);
    expect(target.commands[0]).toMatchObject({ id: "t-cmd-1", usernames: ["dave"], cooldown: 30, enabled: true });
  });

  it("does not rename a resource, since workflows address it by canonical id", async () => {
    const bundle = await bundleWith();
    const target = emptyEngine();
    target.instances.push({
      id: "t-ri-1",
      moduleName: "counter",
      kind: "counter",
      instanceId: "follows",
      displayName: "Someone else's follows",
      canonicalId: "counter:counter:follows",
      settingsJson: "{}",
    });
    const { session } = makeApi(target);

    const plan = await session.previewImport(bundle, { include: ["resources"], onConflict: "rename" });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].action).toBe("conflict");
  });

  it("reports a command granted to a group that exists nowhere", async () => {
    const bundle = await bundleWith();
    const { session } = makeApi(emptyEngine());

    const plan = await session.previewImport(bundle, { include: ["commands"] });

    const item = plan.items.find((i) => i.key === "vanish");
    expect(item?.action).toBe("conflict");
    expect(item?.reasons.find((r) => r.code === "unknown_group")?.message).toContain("VIPs");
  });

  it("applies the same validation as a save and reports a failure per item", async () => {
    const bundle = await bundleWith();
    bundle.workflows[1].definition.tasks = [];
    bundle.commands[0].argumentPattern = "{not valid}";
    const { session } = makeApi(emptyEngine());

    const result = await session.importConfig(bundle);

    expect(result.items.find((i) => i.key === "Thank follower")).toMatchObject({ outcome: "conflict" });
    expect(result.items.find((i) => i.key === "vanish")?.outcome).toBe("conflict");
    expect(result.items.find((i) => i.key === "VIPs")?.outcome).toBe("created");
    // Follow hype starts Thank follower, which never got an id here.
    expect(result.items.find((i) => i.key === "Follow hype")).toMatchObject({ outcome: "failed" });
  });
});

describe("module requirements", () => {
  it("blocks items whose module is not installed and names the module", async () => {
    const bundle = await makeApi(populatedEngine()).api.exportConfig();
    const target = emptyEngine();
    target.modules = target.modules.filter((m) => m.moduleId !== "counter");
    const { session } = makeApi(target);

    const plan = await session.previewImport(bundle);

    expect(plan.missingModules).toEqual([{ moduleId: "counter", version: "2.0.0" }]);
    for (const key of ["counter:counter:follows", "Follow hype"]) {
      const item = plan.items.find((i) => i.key === key);
      expect(item?.action).toBe("conflict");
      expect(item?.reasons.map((r) => r.code)).toContain("missing_module");
    }
    expect(plan.items.find((i) => i.key === "Thank follower")?.action).toBe("create");
  });

  it("warns without blocking when a module is at another version", async () => {
    const bundle = await makeApi(populatedEngine()).api.exportConfig();
    const target = emptyEngine();
    target.modules = target.modules.map((m) => (m.moduleId === "counter" ? { ...m, version: "3.0.0" } : m));
    const { session } = makeApi(target);

    const plan = await session.previewImport(bundle);

    const item = plan.items.find((i) => i.key === "counter:counter:follows");
    expect(item?.action).toBe("create");
    expect(item?.reasons).toContainEqual(expect.objectContaining({ code: "module_version_mismatch", blocking: false }));
  });

  it("blocks a resource whose module declares no such kind", async () => {
    const bundle = await makeApi(populatedEngine()).api.exportConfig();
    const target = emptyEngine();
    target.modules = target.modules.map((m) => (m.moduleId === "counter" ? { ...m, manifest: "{}" } : m));
    const { session } = makeApi(target);

    const plan = await session.previewImport(bundle, { include: ["resources"] });

    expect(plan.items[0].reasons.map((r) => r.code)).toContain("unknown_resource_kind");
  });
});

describe("bundle validation", () => {
  async function validBundle(): Promise<ConfigBundle> {
    return makeApi(populatedEngine()).api.exportConfig();
  }

  it("refuses another version", async () => {
    const { session } = makeApi(emptyEngine());
    const bundle = { ...(await validBundle()), version: 2 } as unknown as ConfigBundle;

    await expect(session.previewImport(bundle)).rejects.toThrow(/Unsupported config bundle version 2/);
  });

  it("refuses another format", async () => {
    const { session } = makeApi(emptyEngine());
    const bundle = { ...(await validBundle()), format: "something.else" } as unknown as ConfigBundle;

    await expect(session.previewImport(bundle)).rejects.toThrow(/format must be "woofx3.config"/);
  });

  it("refuses unknown fields, ids and duplicates, listing each", async () => {
    const { session } = makeApi(emptyEngine());
    const bundle = (await validBundle()) as any;
    bundle.secretSauce = true;
    bundle.workflows[0].definition.id = "src-wf-2";
    bundle.groups.push({ ...bundle.groups[0] });

    const error = await session.previewImport(bundle).catch((err: Error) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('unknown field "secretSauce"');
    expect((error as Error).message).toContain("workflows[0].definition.id");
    expect((error as Error).message).toContain('groups[1]: duplicate "VIPs"');
  });

  it("refuses a module reference missing from requires", async () => {
    const { session } = makeApi(emptyEngine());
    const bundle = await validBundle();
    bundle.requires = bundle.requires.filter((r) => r.moduleId !== "counter");

    await expect(session.previewImport(bundle)).rejects.toThrow(/"counter" is not listed in the bundle's requires/);
  });

  it("refuses a bundle over the size cap before parsing it", async () => {
    const { session } = makeApi(emptyEngine());
    const text = `{"format":"woofx3.config","pad":"${"x".repeat(MAX_CONFIG_BUNDLE_BYTES)}"}`;

    await expect(session.previewImport(text as unknown as ConfigBundle)).rejects.toThrow(/exceeds the/);
  });

  it("refuses an unknown conflict policy", async () => {
    const { session } = makeApi(emptyEngine());

    await expect(session.importConfig(await validBundle(), { onConflict: "merge" as never })).rejects.toThrow(
      /onConflict must be one of/
    );
  });
});
