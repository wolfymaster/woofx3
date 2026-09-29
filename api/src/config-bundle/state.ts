import type { ActionStep, CommandVisibility, WorkflowDefinition } from "@woofx3/api";
import type { DbClient } from "../db-client";
import { parseInstanceSettings } from "../module-event-handlers";
import { parseActions } from "../routes/helpers";

/**
 * The engine's configuration as export and the import planner need it: every
 * row a bundle can describe, plus what the installed modules provide.
 *
 * `userOwned` separates what a creator built from what a module registered.
 * Only the former is exported, and import never replaces the latter: a module
 * reinstalls its own workflows and commands, and an import that rewrote them
 * would be undone, or would break the module, on its next upgrade.
 */
export interface EngineWorkflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  userOwned: boolean;
  trigger: WorkflowDefinition["trigger"] | null;
  tasks: WorkflowDefinition["tasks"];
}

export interface EngineCommand {
  id: string;
  command: string;
  enabled: boolean;
  cooldown: number;
  priority: number;
  visibility: CommandVisibility;
  argumentPattern: string;
  actions: ActionStep[];
  groupIds: string[];
  usernames: string[];
  userOwned: boolean;
}

export interface EngineGroup {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  /** Loaded only when the caller asked for members. */
  members: string[] | null;
}

export interface EngineResource {
  canonicalId: string;
  module: string;
  kind: string;
  instanceId: string;
  displayName: string;
  settings: Record<string, unknown>;
}

export interface EngineModule {
  moduleId: string;
  version: string;
  /** Resource kinds the module's manifest declares. */
  resourceKinds: ReadonlySet<string>;
  /**
   * Permissions the manifest declares. Every action the module owns runs
   * with them, so a step calling any of its actions acts with them too.
   */
  permissions: readonly string[];
  /** Manifest ids of the module's actions declared `systemOnly`. */
  systemOnlyActions: ReadonlySet<string>;
}

export interface EngineConfigState {
  workflows: EngineWorkflow[];
  commands: EngineCommand[];
  groups: EngineGroup[];
  resources: EngineResource[];
  /** Installed modules by manifest module id. */
  modules: ReadonlyMap<string, EngineModule>;
  /** Every registered action name (manifest id), whoever registered it. */
  actionNames: ReadonlySet<string>;
  /** Registered action names to the module that registered them. */
  actionOwners: ReadonlyMap<string, string>;
  /** Trigger event names to the module that declares them. */
  triggerOwners: ReadonlyMap<string, string>;
}

const WORKFLOW_PAGE_SIZE = 100;

function isUserOwned(createdByType: string | undefined): boolean {
  return createdByType === undefined || createdByType === "" || createdByType === "USER";
}

/**
 * The module a registration belongs to. Rows record either the manifest id or
 * the composite module key (`{moduleId}:{version}:{hash}`), whose first
 * segment is the manifest id.
 */
function registeringModule(createdByType: string, createdByRef: string): string {
  if (createdByType !== "MODULE" || !createdByRef) {
    return "";
  }
  return createdByRef.split(":")[0] ?? "";
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface ManifestFacts {
  resourceKinds: Set<string>;
  permissions: string[];
  systemOnlyActions: Set<string>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The parts of an installed manifest the planner reads. Any of them may be
 * absent, since a manifest from an older engine never declared them.
 */
function manifestFacts(rawManifest: string | undefined): ManifestFacts {
  const manifest = parseJson<unknown>(rawManifest, {});
  const facts: ManifestFacts = { resourceKinds: new Set(), permissions: [], systemOnlyActions: new Set() };
  if (!isObject(manifest)) {
    return facts;
  }
  if (Array.isArray(manifest.resources)) {
    for (const entry of manifest.resources) {
      if (isObject(entry) && typeof entry.kind === "string") {
        facts.resourceKinds.add(entry.kind);
      }
    }
  }
  if (Array.isArray(manifest.permissions)) {
    const permissions = manifest.permissions.filter((p): p is string => typeof p === "string" && p !== "");
    facts.permissions = [...new Set(permissions)].sort();
  }
  if (Array.isArray(manifest.actions)) {
    for (const entry of manifest.actions) {
      if (isObject(entry) && typeof entry.id === "string" && entry.systemOnly === true) {
        facts.systemOnlyActions.add(entry.id);
      }
    }
  }
  return facts;
}

async function readWorkflows(db: DbClient): Promise<EngineWorkflow[]> {
  const rows = [];
  for (let page = 1; ; page++) {
    const response = await db.listWorkflows({
      includeDisabled: true,
      page,
      pageSize: WORKFLOW_PAGE_SIZE,
      sortBy: "",
      sortDesc: false,
    });
    rows.push(...response.workflows);
    if (response.workflows.length < WORKFLOW_PAGE_SIZE || rows.length >= response.totalCount) {
      break;
    }
  }
  return rows.map((wf) => ({
    id: wf.id ?? "",
    name: wf.name ?? "",
    description: wf.description ?? "",
    enabled: wf.enabled ?? false,
    userOwned: isUserOwned(wf.createdByType),
    trigger: parseJson<WorkflowDefinition["trigger"] | null>(wf.triggerJson, null),
    tasks: parseJson<WorkflowDefinition["tasks"]>(wf.stepsJson, []),
  }));
}

/**
 * Read everything a bundle can describe. Group members are a query per group,
 * so they are read only when the caller will use them.
 */
export async function readEngineConfig(db: DbClient, options: { members: boolean }): Promise<EngineConfigState> {
  const [workflows, commandRows, groupRows, instances, moduleRows, actionRows, triggerRows] = await Promise.all([
    readWorkflows(db),
    db.listCommands({ includeDisabled: true }),
    db.listGroups({}),
    db.listAllResourceInstances({}),
    db.listModules(),
    db.listActions(),
    db.listTriggers(),
  ]);

  const groups: EngineGroup[] = await Promise.all(
    groupRows.map(async (g) => ({
      id: g.id,
      name: g.name,
      description: g.description ?? "",
      isBuiltIn: g.isBuiltIn ?? false,
      members: options.members ? await db.listGroupMembers({ groupId: g.id }) : null,
    }))
  );

  const modules = new Map<string, EngineModule>();
  for (const m of moduleRows) {
    if (!m.moduleId) {
      continue;
    }
    modules.set(m.moduleId, {
      moduleId: m.moduleId,
      version: m.version ?? "",
      ...manifestFacts(m.manifest),
    });
  }

  const actionNames = new Set<string>();
  const actionOwners = new Map<string, string>();
  for (const a of actionRows) {
    if (a.manifestId) {
      actionNames.add(a.manifestId);
    }
    const owner = registeringModule(a.createdByType, a.createdByRef);
    if (a.manifestId && owner) {
      actionOwners.set(a.manifestId, owner);
    }
  }

  const triggerOwners = new Map<string, string>();
  for (const t of triggerRows) {
    const owner = registeringModule(t.createdByType, t.createdByRef);
    if (t.event && owner) {
      triggerOwners.set(t.event, owner);
    }
  }

  return {
    workflows,
    commands: commandRows.map((c) => ({
      id: c.id,
      command: c.command,
      enabled: c.enabled,
      cooldown: c.cooldown,
      priority: c.priority,
      visibility: (c.visibility || "restricted") as CommandVisibility,
      argumentPattern: c.argumentPattern ?? "",
      actions: parseActions(c.actionsJson),
      groupIds: c.groupIds ?? [],
      usernames: c.usernames ?? [],
      userOwned: isUserOwned(c.createdByType),
    })),
    groups,
    resources: (instances.instances ?? []).map((r) => ({
      canonicalId: r.canonicalId,
      module: r.moduleName,
      kind: r.kind,
      instanceId: r.instanceId,
      displayName: r.displayName,
      settings: parseInstanceSettings(r.settingsJson),
    })),
    modules,
    actionNames,
    actionOwners,
    triggerOwners,
  };
}
