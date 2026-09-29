import type {
  CommandSnapshot,
  ConfigImportOutcome,
  ConfigImportResult,
  ConfigImportResultItem,
  CreateCommandInput,
  CreateGroupInput,
  CreateWorkflowInput,
  GroupSnapshot,
  UpdateCommandInput,
  UpdateGroupInput,
  UpdateWorkflowInput,
  WorkflowDefinition,
  WorkflowMutationResult,
} from "@woofx3/api";
import type { ResourceInstanceDefinition } from "@woofx3/api/webhooks";
import { keepsExisting, type PlannedStep } from "./plan";
import { canonicalResourceId } from "./schema";
import type { EngineConfigState } from "./state";

/**
 * The API methods import writes through: the same ones a person saving in the
 * UI calls, so an imported item is validated, published on the bus and
 * announced by webhook exactly as if it had been created by hand.
 */
export interface ConfigWriter {
  createWorkflow(data: CreateWorkflowInput): Promise<WorkflowMutationResult>;
  updateWorkflow(id: string, data: UpdateWorkflowInput): Promise<WorkflowMutationResult | null>;
  setWorkflowEnabled(id: string, isEnabled: boolean): Promise<{ id: string; isEnabled: boolean }>;
  createCommand(input: CreateCommandInput): Promise<CommandSnapshot>;
  updateCommand(id: string, input: UpdateCommandInput): Promise<CommandSnapshot>;
  createGroup(input: CreateGroupInput): Promise<GroupSnapshot>;
  updateGroup(id: string, input: UpdateGroupInput): Promise<GroupSnapshot>;
  addUserToGroup(groupId: string, username: string): Promise<{ ok: true }>;
  createResourceInstance(
    moduleName: string,
    kind: string,
    instanceId: string,
    displayName: string,
    settings: Record<string, unknown>,
    context: { clientId: string }
  ): Promise<ResourceInstanceDefinition>;
  updateResourceInstance(
    canonicalId: string,
    displayName: string,
    settings: Record<string, unknown>,
    context: { clientId: string }
  ): Promise<ResourceInstanceDefinition>;
}

/** What a bundle name resolves to while applying: an id, or why there is none. */
type Target = { id: string } | { failed: string };

/**
 * Bundle names of groups and workflows as they end up on the engine, so later
 * steps can point at what earlier steps created.
 *
 * Seeded from what is already there, for names the bundle only references.
 * Every name the bundle itself imports starts out unresolved and is settled
 * by its own step: to the id it got, or to why it has none. So a dependent of
 * a step that failed fails too, rather than binding to an unrelated item that
 * shares the name. The one exception is a name collision the `skip` policy
 * kept: there the existing item is, by the creator's choice, the one meant.
 */
class Resolved {
  private readonly targets = new Map<string, Target>();

  constructor(
    private readonly kind: "group" | "workflow",
    existing: ReadonlyArray<{ name: string; id: string }>
  ) {
    for (const item of existing) {
      this.targets.set(item.name, { id: item.id });
    }
  }

  pending(name: string): void {
    this.targets.set(name, { failed: `${this.kind} "${name}", which was not imported before it was needed` });
  }

  set(name: string, target: Target): void {
    this.targets.set(name, target);
  }

  id(name: string): string {
    const target = this.targets.get(name);
    if (!target) {
      throw new Error(`Depends on ${this.kind} "${name}", which does not exist here.`);
    }
    if ("failed" in target) {
      throw new Error(`Depends on ${target.failed}.`);
    }
    return target.id;
  }
}

interface Applied {
  id: string;
  name: string;
  warning?: string;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function addMembers(
  writer: ConfigWriter,
  groupId: string,
  members: readonly string[],
  present: ReadonlySet<string>
): Promise<string | undefined> {
  const failed: string[] = [];
  for (const member of members) {
    if (present.has(member)) {
      continue;
    }
    try {
      await writer.addUserToGroup(groupId, member);
    } catch (err) {
      failed.push(`${member} (${message(err)})`);
    }
  }
  return failed.length > 0 ? `Could not add members: ${failed.join(", ")}.` : undefined;
}

async function applyGroup(
  step: Extract<PlannedStep, { kind: "group" }>,
  writer: ConfigWriter,
  applyMembers: boolean
): Promise<Applied> {
  const { action, targetName } = step.planItem;
  const group = step.item;
  let id: string;
  let present: ReadonlySet<string>;
  if (action === "update" && step.existing) {
    id = (await writer.updateGroup(step.existing.id, { name: targetName, description: group.description })).id;
    present = new Set(step.existing.members ?? []);
  } else {
    id = (await writer.createGroup({ name: targetName, description: group.description })).id;
    present = new Set();
  }
  // Additive: a group on this engine may have members the bundle has never
  // heard of, and dropping them would be a surprise nobody asked for.
  const warning = applyMembers ? await addMembers(writer, id, group.members ?? [], present) : undefined;
  return { id, name: targetName, ...(warning ? { warning } : {}) };
}

async function applyWorkflow(
  step: Extract<PlannedStep, { kind: "workflow" }>,
  writer: ConfigWriter,
  workflows: Resolved
): Promise<Applied> {
  const { action, targetName } = step.planItem;
  const wf = step.item;
  const tasks = wf.definition.tasks.map((task) => {
    const target = wf.workflowRefs[task.id];
    if (target === undefined || !task.workflow) {
      return task;
    }
    return { ...task, workflow: { ...task.workflow, workflowId: workflows.id(target) } };
  });
  const definition: Omit<WorkflowDefinition, "id"> = { ...wf.definition, name: targetName, tasks };

  let id: string;
  let enabled: boolean;
  if (action === "update" && step.existing) {
    id = step.existing.id;
    // Disable before replacing the definition, so a workflow the bundle has
    // switched off never runs its new steps, not even between two writes.
    if (!wf.enabled && step.existing.enabled) {
      await writer.setWorkflowEnabled(id, false);
    }
    const updated = await writer.updateWorkflow(id, { definition: { ...definition, id } });
    if (!updated) {
      throw new Error(`Workflow "${targetName}" disappeared before it could be updated.`);
    }
    enabled = updated.isEnabled;
  } else {
    // createWorkflow always stores a new workflow disabled, so a disabled
    // bundle workflow is created in its final state in one write.
    const created = await writer.createWorkflow({ definition });
    id = created.id;
    enabled = created.isEnabled;
  }

  if (wf.enabled && !enabled) {
    try {
      await writer.setWorkflowEnabled(id, true);
    } catch (err) {
      return { id, name: targetName, warning: `Saved but left disabled: ${message(err)}` };
    }
  }
  return { id, name: targetName };
}

async function applyCommand(
  step: Extract<PlannedStep, { kind: "command" }>,
  writer: ConfigWriter,
  groups: Resolved,
  applyMembers: boolean
): Promise<Applied> {
  const { action, targetName } = step.planItem;
  const cmd = step.item;
  const bundleUsernames = applyMembers ? (cmd.usernames ?? []) : [];
  // Additive, like group members: a bundle never revokes a grant made here.
  const usernames = [
    ...new Set([...(step.existing && action === "update" ? step.existing.usernames : []), ...bundleUsernames]),
  ];
  const input: CreateCommandInput = {
    command: targetName,
    actions: cmd.actions,
    cooldown: cmd.cooldown,
    priority: cmd.priority,
    enabled: cmd.enabled,
    visibility: cmd.visibility,
    groupIds: cmd.groups.map((name) => groups.id(name)),
    usernames,
    argumentPattern: cmd.argumentPattern,
  };
  if (action === "update" && step.existing) {
    const updated = await writer.updateCommand(step.existing.id, input as UpdateCommandInput);
    return { id: updated.id, name: targetName };
  }
  const created = await writer.createCommand(input);
  return { id: created.id, name: targetName };
}

async function applyResource(
  step: Extract<PlannedStep, { kind: "resource" }>,
  writer: ConfigWriter,
  context: { clientId: string }
): Promise<Applied> {
  const r = step.item;
  const canonicalId = canonicalResourceId(r);
  if (step.planItem.action === "update") {
    await writer.updateResourceInstance(canonicalId, r.displayName, r.settings, context);
  } else {
    await writer.createResourceInstance(r.module, r.kind, r.instanceId, r.displayName, r.settings, context);
  }
  return { id: canonicalId, name: canonicalId };
}

/**
 * Carry out a plan, one item at a time, in plan order.
 *
 * db-proxy offers no transaction spanning workflows, commands, groups and
 * module resources, so this is best-effort: an item that fails is reported,
 * its dependents fail with it, and the rest still apply. Whatever did apply is
 * safe to leave, since importing the same bundle again skips every item that
 * made it and retries the rest.
 */
export async function applyImport(
  steps: PlannedStep[],
  state: EngineConfigState,
  writer: ConfigWriter,
  options: { applyMembers: boolean; context: { clientId: string } }
): Promise<ConfigImportResult> {
  const groups = new Resolved("group", state.groups);
  const workflows = new Resolved("workflow", state.workflows);
  const resolvedFor = (step: PlannedStep): Resolved | null =>
    step.kind === "group" ? groups : step.kind === "workflow" ? workflows : null;

  for (const step of steps) {
    if (!keepsExisting(step.planItem)) {
      resolvedFor(step)?.pending(step.planItem.key);
    }
  }

  const items: ConfigImportResultItem[] = [];
  for (const step of steps) {
    const { kind, key, action, targetId } = step.planItem;
    const base = { kind, key, action };
    const resolved = resolvedFor(step);

    if (action === "conflict") {
      const blocking = step.planItem.reasons.find((r) => r.blocking);
      if (!keepsExisting(step.planItem)) {
        resolved?.set(key, {
          failed: `${kind} "${key}", which was not imported${blocking ? `: ${blocking.message}` : ""}`,
        });
      }
      items.push({ ...base, outcome: "conflict", ...(blocking ? { error: blocking.message } : {}) });
      continue;
    }
    if (action === "skip") {
      if (targetId) {
        resolved?.set(key, { id: targetId });
      }
      items.push({ ...base, outcome: "skipped", ...(targetId ? { id: targetId } : {}) });
      continue;
    }

    try {
      let applied: Applied;
      switch (step.kind) {
        case "group":
          applied = await applyGroup(step, writer, options.applyMembers);
          break;
        case "resource":
          applied = await applyResource(step, writer, options.context);
          break;
        case "workflow":
          applied = await applyWorkflow(step, writer, workflows);
          break;
        case "command":
          applied = await applyCommand(step, writer, groups, options.applyMembers);
          break;
      }
      resolved?.set(key, { id: applied.id });
      items.push({
        ...base,
        outcome: action === "update" ? "updated" : "created",
        id: applied.id,
        name: applied.name,
        ...(applied.warning ? { warning: applied.warning } : {}),
      });
    } catch (err) {
      resolved?.set(key, { failed: `${kind} "${key}", which failed: ${message(err)}` });
      items.push({ ...base, outcome: "failed", error: message(err) });
    }
  }

  const summary: Record<ConfigImportOutcome, number> = { created: 0, updated: 0, skipped: 0, conflict: 0, failed: 0 };
  for (const item of items) {
    summary[item.outcome]++;
  }
  return { items, summary };
}
