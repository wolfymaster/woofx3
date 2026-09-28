import {
  CONFIG_BUNDLE_FORMAT,
  CONFIG_BUNDLE_VERSION,
  type ConfigBundle,
  type ConfigBundleCommand,
  type ConfigBundleGroup,
  type ConfigBundleRequirement,
  type ConfigBundleResource,
  type ConfigBundleWorkflow,
  type ConfigSection,
  type TaskDefinition,
} from "@woofx3/api";
import { canonicalize } from "./schema";
import type { EngineCommand, EngineConfigState, EngineGroup, EngineResource, EngineWorkflow } from "./state";

/** `{moduleId}:{kind}:{id}`, the shape of every canonical id a module contributes. */
const CANONICAL_ID = /^([A-Za-z0-9._-]+):[A-Za-z0-9._-]+:.+$/;

function byKey<T>(key: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}

/**
 * Every installed module a value references through a canonical id: a
 * function a step calls, a counter it changes, a theme a widget uses. Only
 * installed module ids count, so an ordinary string that happens to contain
 * two colons is not mistaken for a dependency.
 */
function collectCanonicalRefs(value: unknown, modules: ReadonlyMap<string, unknown>, into: Set<string>): void {
  if (typeof value === "string") {
    const match = CANONICAL_ID.exec(value);
    if (match?.[1] && modules.has(match[1])) {
      into.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectCanonicalRefs(entry, modules, into);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      collectCanonicalRefs(entry, modules, into);
    }
  }
}

function sortedRequires(set: Set<string>): string[] {
  return [...set].sort();
}

/**
 * A workflow in bundle form. Used for export and, by the import planner, to
 * put an existing workflow in the same form so the two can be compared.
 *
 * `workflowNames` maps workflow ids on the engine the workflow lives on to
 * their names. A sub-workflow step whose target is not in it keeps its id: it
 * was already dangling, and blanking it would hide that.
 */
export function workflowToBundle(
  wf: EngineWorkflow,
  workflowNames: ReadonlyMap<string, string>,
  state: Pick<EngineConfigState, "modules" | "actionOwners" | "triggerOwners">
): ConfigBundleWorkflow {
  const requires = new Set<string>();
  const workflowRefs: Record<string, string> = {};
  const tasks: TaskDefinition[] = wf.tasks.map((task) => {
    if (task.type === "action" && task.action) {
      const owner = state.actionOwners.get(task.action);
      if (owner && state.modules.has(owner)) {
        requires.add(owner);
      }
    }
    const targetId = task.workflow?.workflowId;
    const targetName = targetId ? workflowNames.get(targetId) : undefined;
    if (task.workflow && targetName) {
      workflowRefs[task.id] = targetName;
      return { ...task, workflow: { ...task.workflow, workflowId: "" } };
    }
    return task;
  });

  if (wf.trigger?.type === "event") {
    const owner = state.triggerOwners.get(wf.trigger.event);
    if (owner && state.modules.has(owner)) {
      requires.add(owner);
    }
  }
  collectCanonicalRefs(wf.trigger, state.modules, requires);
  collectCanonicalRefs(tasks, state.modules, requires);

  return canonicalize({
    name: wf.name,
    enabled: wf.enabled,
    definition: {
      name: wf.name,
      description: wf.description,
      // A workflow row without a trigger cannot be registered, so it is never
      // exported; see buildConfigBundle.
      trigger: wf.trigger as NonNullable<EngineWorkflow["trigger"]>,
      tasks,
    },
    workflowRefs,
    requires: sortedRequires(requires),
  });
}

/**
 * A command in bundle form. Group grants become group names. `usernames` is
 * included only when `includeMembers` is set, so a comparison against a bundle
 * exported without members ignores them rather than seeing a difference.
 */
export function commandToBundle(
  cmd: EngineCommand,
  groupNames: ReadonlyMap<string, string>,
  includeMembers: boolean,
  state: Pick<EngineConfigState, "modules" | "actionOwners">
): ConfigBundleCommand {
  const requires = new Set<string>();
  for (const action of cmd.actions) {
    const owner = state.actionOwners.get(action.action);
    if (owner && state.modules.has(owner)) {
      requires.add(owner);
    }
  }
  collectCanonicalRefs(cmd.actions, state.modules, requires);

  const groups = cmd.groupIds.map((id) => groupNames.get(id)).filter((name): name is string => name !== undefined);

  return canonicalize({
    command: cmd.command,
    enabled: cmd.enabled,
    cooldown: cmd.cooldown,
    priority: cmd.priority,
    visibility: cmd.visibility,
    argumentPattern: cmd.argumentPattern,
    actions: cmd.actions,
    groups: [...groups].sort(),
    ...(includeMembers ? { usernames: [...cmd.usernames].sort() } : {}),
    requires: sortedRequires(requires),
  });
}

export function groupToBundle(group: EngineGroup, includeMembers: boolean): ConfigBundleGroup {
  return canonicalize({
    name: group.name,
    description: group.description,
    ...(includeMembers ? { members: [...(group.members ?? [])].sort() } : {}),
  });
}

export function resourceToBundle(
  resource: EngineResource,
  state: Pick<EngineConfigState, "modules">
): ConfigBundleResource {
  const requires = new Set<string>([resource.module]);
  collectCanonicalRefs(resource.settings, state.modules, requires);
  return canonicalize({
    module: resource.module,
    kind: resource.kind,
    instanceId: resource.instanceId,
    displayName: resource.displayName,
    settings: resource.settings,
    requires: sortedRequires(requires),
  });
}

/**
 * Build a bundle from the engine's configuration.
 *
 * Only what a creator authored is exported: module-registered workflows and
 * commands come back with their module, and built-in groups exist on every
 * engine. Every section is sorted by its identity, so exports of an unchanged
 * setup diff cleanly.
 */
export function buildConfigBundle(
  state: EngineConfigState,
  options: { sections: ReadonlySet<ConfigSection>; includeMembers: boolean; engineVersion: string; now: Date }
): ConfigBundle {
  const workflowNames = new Map(state.workflows.map((wf) => [wf.id, wf.name]));
  const groupNames = new Map(state.groups.map((g) => [g.id, g.name]));

  const workflows = options.sections.has("workflows")
    ? state.workflows
        .filter((wf) => wf.userOwned && wf.trigger !== null)
        .map((wf) => workflowToBundle(wf, workflowNames, state))
        .sort(byKey((w) => w.name))
    : [];
  const commands = options.sections.has("commands")
    ? state.commands
        .filter((c) => c.userOwned)
        .map((c) => commandToBundle(c, groupNames, options.includeMembers, state))
        .sort(byKey((c) => c.command.toLowerCase()))
    : [];
  const groups = options.sections.has("groups")
    ? state.groups
        .filter((g) => !g.isBuiltIn)
        .map((g) => groupToBundle(g, options.includeMembers))
        .sort(byKey((g) => g.name))
    : [];
  const resources = options.sections.has("resources")
    ? state.resources.map((r) => resourceToBundle(r, state)).sort(byKey((r) => `${r.module}:${r.kind}:${r.instanceId}`))
    : [];

  const required = new Set<string>();
  for (const item of [...workflows, ...commands, ...resources]) {
    for (const moduleId of item.requires) {
      required.add(moduleId);
    }
  }
  const requires: ConfigBundleRequirement[] = [...required].sort().map((moduleId) => ({
    moduleId,
    version: state.modules.get(moduleId)?.version ?? "",
  }));

  return {
    format: CONFIG_BUNDLE_FORMAT,
    version: CONFIG_BUNDLE_VERSION,
    exportedAt: options.now.toISOString(),
    engineVersion: options.engineVersion,
    includeMembers: options.includeMembers,
    requires,
    workflows,
    commands,
    groups,
    resources,
  };
}
