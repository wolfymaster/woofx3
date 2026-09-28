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
import type { EngineCommand, EngineConfigState, EngineGroup, EngineResource, EngineWorkflow } from "./state";

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
 * `renamable` is false for resources, whose canonical id is what everything
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
        reason("name_collision", `No free name found after ${MAX_RENAME_ATTEMPTS} attempts.`, true),
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

function groupContent(group: ConfigBundleGroup, existing: EngineGroup): boolean {
  if (group.description !== existing.description) {
    return false;
  }
  if (!group.members) {
    return true;
  }
  // Import only ever adds members, so an existing group that already has
  // everyone the bundle lists is what import would leave anyway.
  const present = new Set(existing.members ?? []);
  return group.members.every((m) => present.has(m));
}

function planGroups(bundle: ConfigBundle, state: EngineConfigState, policy: ConfigConflictPolicy): PlannedStep[] {
  const byName = new Map(state.groups.map((g) => [g.name, g]));
  return bundle.groups.map((group) => {
    const builtIn = byName.get(group.name);
    if (builtIn?.isBuiltIn) {
      // Every engine has its built-in groups; a bundle naming one just means
      // commands granted to it keep that grant here.
      const decision: Decision<EngineGroup> = {
        action: "skip",
        targetName: group.name,
        existing: builtIn,
        reasons: [reason("not_owned", `"${group.name}" is a built-in group on this engine.`, false)],
      };
      return {
        kind: "group",
        item: group,
        planItem: planItem("group", group.name, decision, builtIn.id),
        existing: builtIn,
      };
    }
    const decision = decide<EngineGroup>(
      group.name,
      policy,
      [],
      (name) => {
        const existing = byName.get(name) ?? null;
        return {
          existing,
          owned: existing !== null && !existing.isBuiltIn,
          identical: existing !== null && groupContent(group, existing),
        };
      },
      (attempt) => (attempt === 1 ? `${group.name} (imported)` : `${group.name} (imported ${attempt})`)
    );
    return {
      kind: "group",
      item: group,
      planItem: planItem("group", group.name, decision, decision.existing?.id),
      existing: decision.existing,
    };
  });
}

function planResources(
  bundle: ConfigBundle,
  state: EngineConfigState,
  policy: ConfigConflictPolicy,
  versions: ReadonlyMap<string, string>
): PlannedStep[] {
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
    // Marked before descending so a reference cycle terminates; the cycle's
    // members keep their name order and the applier reports the unresolved
    // reference.
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

/** The parts of a bundled workflow that make it the same workflow under any name. */
function workflowContent(wf: ConfigBundleWorkflow): unknown {
  const { name: _name, ...definition } = wf.definition;
  return { enabled: wf.enabled, definition, workflowRefs: wf.workflowRefs };
}

function planWorkflows(
  bundle: ConfigBundle,
  state: EngineConfigState,
  policy: ConfigConflictPolicy,
  versions: ReadonlyMap<string, string>,
  sections: ReadonlySet<ConfigSection>
): PlannedStep[] {
  const byName = new Map(state.workflows.map((w) => [w.name, w]));
  const idToName = new Map(state.workflows.map((w) => [w.id, w.name]));
  const bundled = new Set(sections.has("workflows") ? bundle.workflows.map((w) => w.name) : []);

  return orderByReferences(bundle.workflows).map((wf) => {
    const reasons = moduleReasons(wf.requires, versions, state);

    const validation = validateWorkflowDefinition({ id: "pending", ...wf.definition });
    if (!validation.ok) {
      reasons.push(reason("invalid", validation.errors.map((e) => `${e.path}: ${e.message}`).join("; "), true));
    }
    for (const task of wf.definition.tasks ?? []) {
      if (task?.type === "action" && task.action && !state.actionNames.has(task.action)) {
        reasons.push(
          reason(
            "unknown_action",
            `Step "${task.id}" runs "${task.action}", which this engine has not registered.`,
            false
          )
        );
      }
    }
    for (const [taskId, target] of Object.entries(wf.workflowRefs)) {
      if (!bundled.has(target) && !byName.has(target)) {
        reasons.push(
          reason(
            "unknown_workflow",
            `Step "${taskId}" starts workflow "${target}", which is neither in the bundle nor here.`,
            true
          )
        );
      }
    }

    const content = workflowContent(wf);
    const decision = decide<EngineWorkflow>(
      wf.name,
      policy,
      reasons,
      (name) => {
        const existing = byName.get(name) ?? null;
        return {
          existing,
          owned: existing?.userOwned ?? false,
          identical:
            existing !== null &&
            existing.trigger !== null &&
            sameJson(content, workflowContent(workflowToBundle(existing, idToName, state))),
        };
      },
      (attempt) => (attempt === 1 ? `${wf.name} (imported)` : `${wf.name} (imported ${attempt})`)
    );
    return {
      kind: "workflow",
      item: wf,
      planItem: planItem("workflow", wf.name, decision, decision.existing?.id),
      existing: decision.existing,
    };
  });
}

function commandContent(cmd: ConfigBundleCommand): unknown {
  const { command: _command, requires: _requires, ...content } = cmd;
  return content;
}

function planCommands(
  bundle: ConfigBundle,
  state: EngineConfigState,
  policy: ConfigConflictPolicy,
  versions: ReadonlyMap<string, string>,
  sections: ReadonlySet<ConfigSection>
): PlannedStep[] {
  const byWord = new Map(state.commands.map((c) => [c.command.toLowerCase(), c]));
  const groupNames = new Map(state.groups.map((g) => [g.id, g.name]));
  const knownGroups = new Set([
    ...state.groups.map((g) => g.name),
    ...(sections.has("groups") ? bundle.groups.map((g) => g.name) : []),
  ]);

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
    for (const group of cmd.groups) {
      if (!knownGroups.has(group)) {
        reasons.push(
          reason("unknown_group", `Granted to group "${group}", which is neither in the bundle nor here.`, true)
        );
      }
    }

    const content = commandContent(cmd);
    const decision = decide<EngineCommand>(
      cmd.command,
      policy,
      reasons,
      (word) => {
        const existing = byWord.get(word.toLowerCase()) ?? null;
        return {
          existing,
          owned: existing?.userOwned ?? false,
          identical:
            existing !== null &&
            sameJson(
              content,
              commandContent(commandToBundle(existing, groupNames, cmd.usernames !== undefined, state))
            ),
        };
      },
      (attempt) => (attempt === 1 ? `${cmd.command}-imported` : `${cmd.command}-imported-${attempt}`)
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
  options: { policy: ConfigConflictPolicy; sections: ReadonlySet<ConfigSection> }
): PlannedImport {
  const versions = new Map(bundle.requires.map((r) => [r.moduleId, r.version]));
  const { policy, sections } = options;

  const steps: PlannedStep[] = [
    ...(sections.has("groups") ? planGroups(bundle, state, policy) : []),
    ...(sections.has("resources") ? planResources(bundle, state, policy, versions) : []),
    ...(sections.has("workflows") ? planWorkflows(bundle, state, policy, versions, sections) : []),
    ...(sections.has("commands") ? planCommands(bundle, state, policy, versions, sections) : []),
  ];

  const summary = { create: 0, update: 0, skip: 0, conflict: 0 };
  for (const step of steps) {
    summary[step.planItem.action]++;
  }

  const missingModules: ConfigBundleRequirement[] = bundle.requires.filter((r) => !state.modules.has(r.moduleId));

  return {
    plan: { onConflict: policy, items: steps.map((s) => s.planItem), summary, missingModules },
    steps,
  };
}
