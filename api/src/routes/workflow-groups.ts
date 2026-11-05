import type { CreateWorkflowGroupInput, UpdateWorkflowGroupInput, WorkflowGroup } from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import type * as workflow_group from "@woofx3/db/workflow_group.pb";
import { routeModule } from "./context";

function toWorkflowGroup(g: workflow_group.WorkflowGroup): WorkflowGroup {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    enabled: g.enabled,
    memberIds: g.memberIds ?? [],
  };
}

/**
 * Workflow groups (alert groups). db-proxy owns the hold and release rules
 * and announces every change on its outbox; these methods also echo the
 * group with the caller's correlationKey, which is what a caller waiting on
 * its own change listens for.
 */
export const workflowGroupsRoutes = routeModule({
  async listWorkflowGroups(): Promise<WorkflowGroup[]> {
    const groups = await this.db.listWorkflowGroups();
    return groups.map(toWorkflowGroup);
  },

  async createWorkflowGroup(input: CreateWorkflowGroupInput): Promise<WorkflowGroup> {
    const group = toWorkflowGroup(
      await this.db.createWorkflowGroup({ name: input.name, description: input.description ?? "" })
    );
    void this.emitWorkflowGroupWebhook({
      type: EngineEventType.WORKFLOW_GROUP_CREATED,
      correlationKey: input.correlationKey,
      group,
    });
    return group;
  },

  async updateWorkflowGroup(id: string, input: UpdateWorkflowGroupInput): Promise<WorkflowGroup> {
    const group = toWorkflowGroup(
      await this.db.updateWorkflowGroup({ id, name: input.name, description: input.description ?? "" })
    );
    void this.emitWorkflowGroupWebhook({
      type: EngineEventType.WORKFLOW_GROUP_UPDATED,
      correlationKey: input.correlationKey,
      group,
    });
    return group;
  },

  async deleteWorkflowGroup(id: string, correlationKey?: string): Promise<{ deleted: boolean }> {
    await this.db.deleteWorkflowGroup({ id });
    void this.emitWorkflowGroupWebhook({
      type: EngineEventType.WORKFLOW_GROUP_DELETED,
      correlationKey,
      groupId: id,
    });
    return { deleted: true };
  },

  async setWorkflowGroupEnabled(id: string, enabled: boolean, correlationKey?: string): Promise<WorkflowGroup> {
    const group = toWorkflowGroup(await this.db.setWorkflowGroupEnabled({ id, enabled }));
    void this.emitWorkflowGroupWebhook({ type: EngineEventType.WORKFLOW_GROUP_UPDATED, correlationKey, group });
    return group;
  },

  async addWorkflowGroupMembers(
    groupId: string,
    workflowIds: string[],
    correlationKey?: string
  ): Promise<WorkflowGroup> {
    const group = toWorkflowGroup(await this.db.addWorkflowGroupMembers({ groupId, workflowIds }));
    void this.emitWorkflowGroupWebhook({ type: EngineEventType.WORKFLOW_GROUP_UPDATED, correlationKey, group });
    return group;
  },

  async removeWorkflowGroupMembers(
    groupId: string,
    workflowIds: string[],
    correlationKey?: string
  ): Promise<WorkflowGroup> {
    const group = toWorkflowGroup(await this.db.removeWorkflowGroupMembers({ groupId, workflowIds }));
    void this.emitWorkflowGroupWebhook({ type: EngineEventType.WORKFLOW_GROUP_UPDATED, correlationKey, group });
    return group;
  },
});
