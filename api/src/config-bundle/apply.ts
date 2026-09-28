import type {
  CommandSnapshot,
  ConfigImportOutcome,
  ConfigImportResult,
  ConfigImportResultItem,
  CreateCommandInput,
  CreateGroupInput,
  CreateWorkflowInput,
  GroupSnapshot,
  TaskDefinition,
  UpdateCommandInput,
  UpdateGroupInput,
  UpdateWorkflowInput,
  WorkflowDefinition,
  WorkflowMutationResult,
} from "@woofx3/api";
import type { ResourceInstanceDefinition } from "@woofx3/api/webhooks";
import type { PlannedStep } from "./plan";
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

/**
 * Names of items as they end up on the engine, so later steps can point at
 * what earlier steps created. Seeded from what is already there: an item the
 * plan skipped or left in conflict keeps its name here, which is what "keep
 * what is there" means for everything that references it.
 */
interface Resolved {
  groupIds: Map<string, string>;
  workflowIds: Map<string, string>;
}

function resolveWorkflowRefs(
  tasks: TaskDefinition[],
  refs: Record<string, string>,
  workflowIds: ReadonlyMap<string, string>
): TaskDefinition[] {
  return tasks.map((task) => {
    const target = refs[task.id];
    if (target === undefined || !task.workflow) {
      return task;
    }
    const id = workflowIds.get(target);
    if (!id) {
      throw new Error(`Step "${task.id}" starts workflow "${target}", which was not imported.`);
    }
    return { ...task, workflow: { ...task.workflow, workflowId: id } };
  });
}

async function applyStep(
  step: PlannedStep,
  writer: ConfigWriter,
  resolved: Resolved,
  context: { clientId: string }
): Promise<{ id: string; name: string }> {
  const { action, targetName } = step.planItem;

  switch (step.kind) {
    case "group": {
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
      resolved.groupIds.set(group.name, id);
      // Additive: a group on this engine may have members the bundle has
      // never heard of, and dropping them would be a surprise nobody asked for.
      for (const member of group.members ?? []) {
        if (!present.has(member)) {
          await writer.addUserToGroup(id, member);
        }
      }
      return { id, name: targetName };
    }

    case "resource": {
      const r = step.item;
      const canonicalId = canonicalResourceId(r);
      if (action === "update") {
        await writer.updateResourceInstance(canonicalId, r.displayName, r.settings, context);
      } else {
        await writer.createResourceInstance(r.module, r.kind, r.instanceId, r.displayName, r.settings, context);
      }
      return { id: canonicalId, name: canonicalId };
    }

    case "workflow": {
      const wf = step.item;
      const definition: Omit<WorkflowDefinition, "id"> = {
        ...wf.definition,
        name: targetName,
        tasks: resolveWorkflowRefs(wf.definition.tasks, wf.workflowRefs, resolved.workflowIds),
      };
      let id: string;
      let enabled: boolean;
      if (action === "update" && step.existing) {
        id = step.existing.id;
        const updated = await writer.updateWorkflow(id, { definition: { ...definition, id } });
        if (!updated) {
          throw new Error(`Workflow "${targetName}" disappeared before it could be updated.`);
        }
        enabled = updated.isEnabled;
      } else {
        const created = await writer.createWorkflow({ definition });
        id = created.id;
        enabled = created.isEnabled;
      }
      resolved.workflowIds.set(wf.name, id);
      if (enabled !== wf.enabled) {
        await writer.setWorkflowEnabled(id, wf.enabled);
      }
      return { id, name: targetName };
    }

    case "command": {
      const cmd = step.item;
      const groupIds = cmd.groups.map((name) => {
        const id = resolved.groupIds.get(name);
        if (!id) {
          throw new Error(`Granted to group "${name}", which was not imported.`);
        }
        return id;
      });
      const input: CreateCommandInput = {
        command: targetName,
        actions: cmd.actions,
        cooldown: cmd.cooldown,
        priority: cmd.priority,
        enabled: cmd.enabled,
        visibility: cmd.visibility,
        groupIds,
        // A bundle exported without members says nothing about who a
        // command is granted to by name, so an overwrite keeps the grants
        // already there instead of revoking them.
        usernames: cmd.usernames ?? step.existing?.usernames ?? [],
        argumentPattern: cmd.argumentPattern,
      };
      if (action === "update" && step.existing) {
        const updated = await writer.updateCommand(step.existing.id, input as UpdateCommandInput);
        return { id: updated.id, name: targetName };
      }
      const created = await writer.createCommand(input);
      return { id: created.id, name: targetName };
    }
  }
}

/**
 * Carry out a plan, one item at a time, in plan order.
 *
 * db-proxy offers no transaction spanning workflows, commands, groups and
 * module resources, so this is best-effort: an item that fails is reported and
 * the rest still apply. Whatever did apply is safe to leave, since importing
 * the same bundle again skips every item that made it and retries the rest.
 */
export async function applyImport(
  steps: PlannedStep[],
  state: EngineConfigState,
  writer: ConfigWriter,
  context: { clientId: string }
): Promise<ConfigImportResult> {
  const resolved: Resolved = {
    groupIds: new Map(state.groups.map((g) => [g.name, g.id])),
    workflowIds: new Map(state.workflows.map((w) => [w.name, w.id])),
  };

  const items: ConfigImportResultItem[] = [];
  for (const step of steps) {
    const { kind, key, action, targetId } = step.planItem;
    const base = { kind, key, action };

    if (action === "conflict") {
      const blocking = step.planItem.reasons.find((r) => r.blocking);
      items.push({ ...base, outcome: "conflict", ...(blocking ? { error: blocking.message } : {}) });
      continue;
    }
    if (action === "skip") {
      if (step.kind === "group" && targetId) {
        resolved.groupIds.set(step.item.name, targetId);
      }
      if (step.kind === "workflow" && targetId) {
        resolved.workflowIds.set(step.item.name, targetId);
      }
      items.push({ ...base, outcome: "skipped", ...(targetId ? { id: targetId } : {}) });
      continue;
    }

    try {
      const { id, name } = await applyStep(step, writer, resolved, context);
      items.push({ ...base, outcome: action === "update" ? "updated" : "created", id, name });
    } catch (err) {
      items.push({ ...base, outcome: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }

  const summary: Record<ConfigImportOutcome, number> = { created: 0, updated: 0, skipped: 0, conflict: 0, failed: 0 };
  for (const item of items) {
    summary[item.outcome]++;
  }
  return { items, summary };
}
