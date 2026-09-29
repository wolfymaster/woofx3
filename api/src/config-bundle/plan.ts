import type {
  ConfigBundle,
  ConfigBundleCommand,
  ConfigBundleGroup,
  ConfigBundleRequirement,
  ConfigBundleResource,
  ConfigBundleWorkflow,
  ConfigConflictPolicy,
  ConfigImportAction,
  ConfigImportPlan,
  ConfigImportPlanItem,
  ConfigImportReason,
  ConfigItemKind,
  ConfigSection,
} from "@woofx3/api";
import { invalidCommandVariableNames } from "@woofx3/common/templates/command-variables";
import { serializeActions } from "../routes/commands";
import { validateWorkflowDefinition } from "../workflow/validate-definition";
import { commandToBundle, workflowToBundle } from "./export";
import { canonicalResourceId, sameJson } from "./schema";
import type {
  EngineCommand,
  EngineConfigState,
  EngineGroup,
  EngineModule,
  EngineResource,
  EngineWorkflow,
} from "./state";

/**
 * One bundle item and what import will do with it. The public plan item is
 * what a client sees; the rest is what the applier needs to carry it out.
 */
export type PlannedStep =
  | { kind: "group"; item: ConfigBundleGroup; planItem: ConfigImportPlanItem; existing: EngineGroup | null }
  | { kind: "resource"; item: ConfigBundleResource; planItem: ConfigImportPlanItem; existing: EngineResource | null }
  | { kind: "workflow"; item: ConfigBundleWorkflow; planItem: ConfigImportPlanItem; existing: EngineWorkflow | null }
  | { kind: "command"; item: ConfigBundleCommand; planItem: ConfigImportPlanItem; existing: EngineCommand | null };

export interface PlannedImport {
  plan: ConfigImportPlan;
  steps: PlannedStep[];
  applyMembers: boolean;
}

/**
 * Where a bundle name ends up on this engine: the name to resolve it by, or
 * why nothing will be there. Dependents compare and resolve through this, so
 * a renamed group or workflow is followed to its new name, and a dependency
 * that will not be imported blocks its dependents instead of letting them
 * quietly bind to an unrelated item that happens to share the old name.
 */
export type Destination = { name: string } | { blocked: string };

/** `{moduleId}:action:{manifestId}`, an action named by its canonical id. */
const CANONICAL_ACTION = /^([A-Za-z0-9._-]+):action:(.+)$/;

/**
 * The installed module that owns an action, and the action's id within that
 * module's manifest. Null when no installed module owns it; `unknown_action`
 * covers that case.
 */
function actionOwner(action: string, state: EngineConfigState): { module: EngineModule; actionId: string } | null {
  const canonical = CANONICAL_ACTION.exec(action);
  if (canonical?.[1] && canonical[2]) {
    const module = state.modules.get(canonical[1]);
    return module ? { module, actionId: canonical[2] } : null;
  }
  const moduleId = state.actionOwners.get(action);
  const module = moduleId ? state.modules.get(moduleId) : undefined;
  return module ? { module, actionId: action } : null;
}

/**
 * Why running an action is privileged, or null when it is not. An action
 * runs with every permission its owning module declares, so any declared
 * permission makes each of the module's actions privileged; the manifest is
 * the only place that knows what an action can reach, which keeps platform
 * specifics out of this check. A `systemOnly` action is one a system module
 * reserved for itself.
 */
function privilegeOf(action: string, state: EngineConfigState): string | null {
  const owner = actionOwner(action, state);
  if (owner === null) {
    return null;
  }
  const grounds: string[] = [];
  if (owner.module.permissions.length > 0) {
    grounds.push(
      `runs with the permissions of module "${owner.module.moduleId}": ${owner.module.permissions.join(", ")}`
    );
  }
  if (owner.module.systemOnlyActions.has(owner.actionId)) {
    grounds.push(`is reserved for system modules by "${owner.module.moduleId}"`);
  }
  return grounds.length > 0 ? `"${action}" ${grounds.join(" and ")}` : null;
}

function privilegedReason(actions: string[], state: EngineConfigState): ConfigImportReason[] {
  const details = [...new Set(actions)]
    .sort()
    .map((action) => privilegeOf(action, state))
    .filter((detail): detail is string => detail !== null);
  if (details.length === 0) {
    return [];
  }
  return [reason("privileged_action", `${details.join("; ")}.`, false)];
}

/**
 * A conflict that leaves the same-named item already on the engine standing
 * in for the bundle's: the only thing stopping it is a name collision the
 * `skip` policy chose to keep. Any other conflict means the item is simply
 * not there.
 */
export function keepsExisting(item: ConfigImportPlanItem): boolean {
  const blocking = item.reasons.filter((r) => r.blocking);
  return item.action === "conflict" && blocking.length > 0 && blocking.every((r) => r.code === "name_collision");
}

function destinationOf(item: ConfigImportPlanItem): Destination {
  if (item.action !== "conflict") {
    return { name: item.targetName };
  }
  if (keepsExisting(item)) {
    return { name: item.key };
  }
  const blocking = item.reasons.find((r) => r.blocking);
  return { blocked: `"${item.key}" will not be imported${blocking ? `: ${blocking.message}` : ""}` };
}

/**
 * Resolve a name a dependent uses. Bundle items planned so far answer through
 * their destination; a bundle item not yet planned is part of a reference
 * cycle; anything else must already exist on the engine.
 */
function resolveName(
  name: string,
  planned: ReadonlyMap<string, Destination>,
  inBundle: ReadonlySet<string>,
  onEngine: ReadonlySet<string>
): Destination | undefined {
  const destination = planned.get(name);
  if (destination) {
    return destination;
  }
  if (inBundle.has(name)) {
    return { blocked: `"${name}" is part of a reference cycle` };
  }
  return onEngine.has(name) ? { name } : undefined;
}

function sortedDifference(wanted: readonly string[], present: readonly string[]): string[] {
  const have = new Set(present);
  return [...new Set(wanted.filter((u) => !have.has(u)))].sort();
}

/**
 * Report what the item's usernames will do: with `applyMembers`, which
 * usernames gain access; without it, that the bundle's usernames are left out.
 */
function accessReasons(
  usernames: readonly string[] | undefined,
  applyMembers: boolean,
  decision: Decision<unknown>,
  present: readonly string[],
  what: string
): ConfigImportReason[] {
  if (!usernames || usernames.length === 0) {
    return [];
  }
  if (!applyMembers) {
    return [
      reason("members_not_applied", `The bundle's ${what} are left out; import with applyMembers to add them.`, false),
    ];
  }
  if (decision.action !== "create" && decision.action !== "update") {
    return [];
  }
  const granted = sortedDifference(usernames, decision.action === "update" ? present : []);
  if (granted.length === 0) {
    return [];
  }
  return [reason("grants_access", `Grants access to ${granted.join(", ")}.`, false)];
}

/** Enough attempts for any real setup; past this, something is generating names. */
const MAX_RENAME_ATTEMPTS = 100;

interface Candidate<E> {
  /** The existing item with this name, or null when the name is free. */
  existing: E | null;
  /** Whether the existing item is the creator's own, and so replaceable. */
  owned: boolean;
  identical: boolean;
}

interface Decision<E> {
  action: ConfigImportAction;
  targetName: string;
  existing: E | null;
  reasons: ConfigImportReason[];
}

function reason(code: ConfigImportReason["code"], message: string, blocking: boolean): ConfigImportReason {
  return { code, message, blocking };
}

/**
 * The rule every kind shares: blocking problems win; then an identical item
 * is skipped; then the conflict policy decides a collision.
 *
 * `renamed` is null for resources, whose canonical id is what everything
 * else references them by.
 */
function decide<E>(
  key: string,
  policy: ConfigConflictPolicy,
  reasons: ConfigImportReason[],
  lookup: (name: string) => Candidate<E>,
  renamed: ((attempt: number) => string) | null
): Decision<E> {
  if (reasons.some((r) => r.blocking)) {
    return { action: "conflict", targetName: key, existing: lookup(key).existing, reasons };
  }

  const current = lookup(key);
  if (current.existing === null) {
    return { action: "create", targetName: key, existing: null, reasons };
  }
  if (current.owned && current.identical) {
    return {
      action: "skip",
      targetName: key,
      existing: current.existing,
      reasons: [...reasons, reason("identical", "Already present and unchanged.", false)],
    };
  }

  if (policy === "rename" && renamed) {
    for (let attempt = 1; attempt <= MAX_RENAME_ATTEMPTS; attempt++) {
      const name = renamed(attempt);
      const candidate = lookup(name);
      if (candidate.existing === null) {
        return {
          action: "create",
          targetName: name,
          existing: null,
          reasons: [...reasons, reason("renamed", `"${key}" is taken; importing as "${name}".`, false)],
        };
      }
      if (candidate.owned && candidate.identical) {
        return {
          action: "skip",
          targetName: name,
          existing: candidate.existing,
          reasons: [...reasons, reason("identical", `Already imported as "${name}".`, false)],
        };
      }
    }
    return {
      action: "conflict",
      targetName: key,
      existing: current.existing,
      reasons: [
        ...reasons,
        reason("rename_exhausted", `No free name found after ${MAX_RENAME_ATTEMPTS} attempts.`, true),
      ],
    };
  }

  if (!current.owned) {
    return {
      action: "conflict",
      targetName: key,
      existing: current.existing,
      reasons: [
        ...reasons,
        reason(
          "not_owned",
          `"${key}" belongs to an installed module, which import never replaces. Import with rename to keep both.`,
          true
        ),
      ],
    };
  }

  if (policy === "overwrite") {
    return {
      action: "update",
      targetName: key,
      existing: current.existing,
      reasons: [...reasons, reason("overwrite", `Replaces the existing "${key}".`, false)],
    };
  }

  const hint = renamed ? "Import with rename or overwrite to apply it." : "Import with overwrite to apply it.";
  return {
    action: "conflict",
    targetName: key,
    existing: current.existing,
    reasons: [...reasons, reason("name_collision", `"${key}" already exists and differs. ${hint}`, true)],
  };
}

function moduleReasons(
  requires: string[],
  bundleVersions: ReadonlyMap<string, string>,
  state: EngineConfigState
): ConfigImportReason[] {
  const reasons: ConfigImportReason[] = [];
  for (const moduleId of requires) {
    const installed = state.modules.get(moduleId);
    if (!installed) {
      reasons.push(reason("missing_module", `Requires module "${moduleId}", which is not installed.`, true));
      continue;
    }
    const wanted = bundleVersions.get(moduleId) ?? "";
    if (wanted !== "" && installed.version !== wanted) {
      reasons.push(
        reason(
          "module_version_mismatch",
          `Exported with "${moduleId}" ${wanted}; this engine has ${installed.version}.`,
          false
        )
      );
    }
  }
  return reasons;
}

function planItem(
  kind: ConfigItemKind,
  key: string,
  decision: Decision<unknown>,
  targetId?: string
): ConfigImportPlanItem {
  return {
    kind,
    key,
    action: decision.action,
    targetName: decision.targetName,
    ...(targetId && (decision.action === "update" || decision.action === "skip") ? { targetId } : {}),
    reasons: decision.reasons,
  };
}

interface PlanContext {
  bundle: ConfigBundle;
  state: EngineConfigState;
  policy: ConfigConflictPolicy;
  sections: ReadonlySet<ConfigSection>;
  applyMembers: boolean;
  versions: ReadonlyMap<string, string>;
  groupDestinations: Map<string, Destination>;
  workflowDestinations: Map<string, Destination>;
}

function planGroups(ctx: PlanContext): PlannedStep[] {
  const { bundle, state, policy, applyMembers } = ctx;
  const byName = new Map(state.groups.map((g) => [g.name, g]));
  return bundle.groups.map((group) => {
    const builtIn = byName.get(group.name);
    let decision: Decision<EngineGroup>;
    if (builtIn?.isBuiltIn) {
      // Every engine has its built-in groups; a bundle naming one just means
      // commands granted to it keep that grant here.
      decision = {
        action: "skip",
        targetName: group.name,
        existing: builtIn,
        reasons: [reason("not_owned", `"${group.name}" is a built-in group on this engine.`, false)],
      };
    } else {
      // Import only ever adds members, so an existing group that already has
      // everyone the bundle lists is what import would leave anyway.
      const wantedMembers = applyMembers ? (group.members ?? []) : [];
      decision = decide<EngineGroup>(
        group.name,
        policy,
        [],
        (name) => {
          const existing = byName.get(name) ?? null;
          return {
            existing,
            owned: existing !== null && !existing.isBuiltIn,
            identical:
              existing !== null &&
              existing.description === group.description &&
              sortedDifference(wantedMembers, existing.members ?? []).length === 0,
          };
        },
        (attempt) => (attempt === 1 ? `${group.name} (imported)` : `${group.name} (imported ${attempt})`)
      );
      decision.reasons.push(
        ...accessReasons(group.members, applyMembers, decision, decision.existing?.members ?? [], "group members")
      );
    }
    const item = planItem("group", group.name, decision, decision.existing?.id);
    ctx.groupDestinations.set(group.name, destinationOf(item));
    return { kind: "group", item: group, planItem: item, existing: decision.existing };
  });
}

function planResources(ctx: PlanContext): PlannedStep[] {
  const { bundle, state, policy, versions } = ctx;
  const byId = new Map(state.resources.map((r) => [r.canonicalId, r]));
  return bundle.resources.map((resource) => {
    const key = canonicalResourceId(resource);
    const reasons = moduleReasons(resource.requires, versions, state);
    const owner = state.modules.get(resource.module);
    if (owner && !owner.resourceKinds.has(resource.kind)) {
      reasons.push(
        reason("unknown_resource_kind", `Module "${resource.module}" declares no "${resource.kind}" resource.`, true)
      );
    }
    const decision = decide<EngineResource>(
      key,
      policy,
      reasons,
      (id) => {
        const existing = byId.get(id) ?? null;
        return {
          existing,
          owned: existing !== null,
          identical:
            existing !== null &&
            sameJson(
              { displayName: resource.displayName, settings: resource.settings },
              { displayName: existing.displayName, settings: existing.settings }
            ),
        };
      },
      null
    );
    return {
      kind: "resource",
      item: resource,
      planItem: planItem("resource", key, decision, decision.existing?.canonicalId),
      existing: decision.existing,
    };
  });
}

/** Referenced workflows first, so a sub-workflow step can be pointed at an id that exists. */
function orderByReferences(workflows: ConfigBundleWorkflow[]): ConfigBundleWorkflow[] {
  const byName = new Map(workflows.map((w) => [w.name, w]));
  const ordered: ConfigBundleWorkflow[] = [];
  const visited = new Set<string>();
  const visit = (wf: ConfigBundleWorkflow): void => {
    if (visited.has(wf.name)) {
      return;
    }
    // Marked before descending so a reference cycle terminates; resolveName
    // then reports the cycle on whichever member is planned first.
    visited.add(wf.name);
    for (const target of Object.values(wf.workflowRefs).sort()) {
      const dependency = byName.get(target);
      if (dependency) {
        visit(dependency);
      }
    }
    ordered.push(wf);
  };
  for (const wf of workflows) {
    visit(wf);
  }
  return ordered;
}

/**
 * The parts of a workflow that make it the same workflow under any name, with
 * sub-workflow targets given as the names they have on this engine.
 */
function workflowContent(wf: ConfigBundleWorkflow, workflowRefs: Record<string, string>): unknown {
  const { name: _name, ...definition } = wf.definition;
  return { enabled: wf.enabled, definition, workflowRefs };
}

function planWorkflows(ctx: PlanContext): PlannedStep[] {
  const { bundle, state, policy, versions, sections } = ctx;
  const byName = new Map(state.workflows.map((w) => [w.name, w]));
  const idToName = new Map(state.workflows.map((w) => [w.id, w.name]));
  const inBundle = new Set(sections.has("workflows") ? bundle.workflows.map((w) => w.name) : []);
  const onEngine = new Set(byName.keys());

  return orderByReferences(bundle.workflows).map((wf) => {
    const reasons = moduleReasons(wf.requires, versions, state);

    const validation = validateWorkflowDefinition({ id: "pending", ...wf.definition });
    if (!validation.ok) {
      reasons.push(reason("invalid", validation.errors.map((e) => `${e.path}: ${e.message}`).join("; "), true));
    }
    const actions: string[] = [];
    for (const task of wf.definition.tasks ?? []) {
      if (task?.type !== "action" || !task.action) {
        continue;
      }
      actions.push(task.action);
      if (!state.actionNames.has(task.action)) {
        reasons.push(
          reason(
            "unknown_action",
            `Step "${task.id}" runs "${task.action}", which this engine has not registered.`,
            false
          )
        );
      }
    }
    reasons.push(...privilegedReason(actions, state));

    const resolvedRefs: Record<string, string> = {};
    for (const [taskId, target] of Object.entries(wf.workflowRefs)) {
      const destination = resolveName(target, ctx.workflowDestinations, inBundle, onEngine);
      if (!destination) {
        reasons.push(
          reason(
            "unknown_workflow",
            `Step "${taskId}" starts workflow "${target}", which is neither in the bundle nor here.`,
            true
          )
        );
      } else if ("blocked" in destination) {
        reasons.push(reason("dependency_blocked", `Step "${taskId}" starts ${destination.blocked}.`, true));
      } else {
        resolvedRefs[taskId] = destination.name;
      }
    }

    const content = workflowContent(wf, resolvedRefs);
    const decision = decide<EngineWorkflow>(
      wf.name,
      policy,
      reasons,
      (name) => {
        const existing = byName.get(name) ?? null;
        if (existing === null || existing.trigger === null) {
          return { existing, owned: existing?.userOwned ?? false, identical: false };
        }
        const current = workflowToBundle(existing, idToName, state);
        return {
          existing,
          owned: existing.userOwned,
          identical: sameJson(content, workflowContent(current, current.workflowRefs)),
        };
      },
      (attempt) => (attempt === 1 ? `${wf.name} (imported)` : `${wf.name} (imported ${attempt})`)
    );
    const item = planItem("workflow", wf.name, decision, decision.existing?.id);
    ctx.workflowDestinations.set(wf.name, destinationOf(item));
    return { kind: "workflow", item: wf, planItem: item, existing: decision.existing };
  });
}

/** What makes two commands the same, apart from their word and who they grant by name. */
function commandContent(cmd: ConfigBundleCommand, groups: string[]): unknown {
  const { command: _command, requires: _requires, usernames: _usernames, ...content } = cmd;
  return { ...content, groups: [...groups].sort() };
}

function planCommands(ctx: PlanContext): PlannedStep[] {
  const { bundle, state, policy, versions, sections, applyMembers } = ctx;
  const byWord = new Map(state.commands.map((c) => [c.command.toLowerCase(), c]));
  const groupNames = new Map(state.groups.map((g) => [g.id, g.name]));
  const inBundle = new Set(sections.has("groups") ? bundle.groups.map((g) => g.name) : []);
  const onEngine = new Set(state.groups.map((g) => g.name));

  return bundle.commands.map((cmd) => {
    const reasons = moduleReasons(cmd.requires, versions, state);

    const invalidNames = invalidCommandVariableNames(cmd.argumentPattern);
    if (invalidNames.length > 0) {
      reasons.push(
        reason("invalid", `Invalid {variable} name(s) in argumentPattern: ${invalidNames.join(", ")}.`, true)
      );
    }
    try {
      serializeActions(cmd.actions);
    } catch (err) {
      reasons.push(reason("invalid", err instanceof Error ? err.message : String(err), true));
    }
    reasons.push(
      ...privilegedReason(
        cmd.actions.map((a) => a?.action).filter((a): a is string => !!a),
        state
      )
    );

    const resolvedGroups: string[] = [];
    for (const group of cmd.groups) {
      const destination = resolveName(group, ctx.groupDestinations, inBundle, onEngine);
      if (!destination) {
        reasons.push(
          reason("unknown_group", `Granted to group "${group}", which is neither in the bundle nor here.`, true)
        );
      } else if ("blocked" in destination) {
        reasons.push(reason("dependency_blocked", `Granted to group ${destination.blocked}.`, true));
      } else {
        resolvedGroups.push(destination.name);
      }
    }

    const content = commandContent(cmd, resolvedGroups);
    const wantedUsernames = applyMembers ? (cmd.usernames ?? []) : [];
    const decision = decide<EngineCommand>(
      cmd.command,
      policy,
      reasons,
      (word) => {
        const existing = byWord.get(word.toLowerCase()) ?? null;
        if (existing === null) {
          return { existing, owned: false, identical: false };
        }
        const current = commandToBundle(existing, groupNames, false, state);
        return {
          existing,
          owned: existing.userOwned,
          identical:
            sameJson(content, commandContent(current, current.groups)) &&
            sortedDifference(wantedUsernames, existing.usernames).length === 0,
        };
      },
      (attempt) => (attempt === 1 ? `${cmd.command}-imported` : `${cmd.command}-imported-${attempt}`)
    );
    decision.reasons.push(
      ...accessReasons(cmd.usernames, applyMembers, decision, decision.existing?.usernames ?? [], "command usernames")
    );
    return {
      kind: "command",
      item: cmd,
      planItem: planItem("command", cmd.command, decision, decision.existing?.id),
      existing: decision.existing,
    };
  });
}

/**
 * Work out, without writing anything, what importing `bundle` into an engine
 * in `state` would do. Groups come first, then resources, workflows and
 * commands: commands are granted to groups, and workflows reference resources
 * and each other.
 */
export function planImport(
  bundle: ConfigBundle,
  state: EngineConfigState,
  options: { policy: ConfigConflictPolicy; sections: ReadonlySet<ConfigSection>; applyMembers: boolean }
): PlannedImport {
  const ctx: PlanContext = {
    bundle,
    state,
    policy: options.policy,
    sections: options.sections,
    applyMembers: options.applyMembers,
    versions: new Map(bundle.requires.map((r) => [r.moduleId, r.version])),
    groupDestinations: new Map(),
    workflowDestinations: new Map(),
  };
  const { sections } = options;

  const steps: PlannedStep[] = [
    ...(sections.has("groups") ? planGroups(ctx) : []),
    ...(sections.has("resources") ? planResources(ctx) : []),
    ...(sections.has("workflows") ? planWorkflows(ctx) : []),
    ...(sections.has("commands") ? planCommands(ctx) : []),
  ];

  const summary = { create: 0, update: 0, skip: 0, conflict: 0 };
  for (const step of steps) {
    summary[step.planItem.action]++;
  }

  const missingModules: ConfigBundleRequirement[] = bundle.requires.filter((r) => !state.modules.has(r.moduleId));

  return {
    plan: {
      onConflict: options.policy,
      applyMembers: options.applyMembers,
      items: steps.map((s) => s.planItem),
      summary,
      missingModules,
    },
    steps,
    applyMembers: options.applyMembers,
  };
}
