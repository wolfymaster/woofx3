import type { CreateGroupInput, GroupSnapshot, UpdateGroupInput } from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";

function groupToSnapshot(g: { id: string; applicationId: string; name: string; description: string; createdAt: unknown }): GroupSnapshot {
  return {
    id: g.id,
    applicationId: g.applicationId,
    name: g.name,
    description: g.description,
    createdAt:
      g.createdAt && typeof g.createdAt === "object" && "seconds" in (g.createdAt as Record<string, unknown>)
        ? new Date(Number((g.createdAt as { seconds: bigint | number }).seconds) * 1000).toISOString()
        : "",
  };
}

/**
 * "User groups" (roles) - the only permission concept exposed to the UI.
 * Users are added to groups; commands are granted to groups (or specific
 * users, or left "public") via CreateCommandInput/UpdateCommandInput.
 */
export const groupsRoutes = {
  async listGroups(): Promise<GroupSnapshot[]> {
    const applicationId = await this.ensureApplicationId();
    const response = await this.db.listGroups({ applicationId });
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to list groups");
    }
    return (response.groups ?? []).map(groupToSnapshot);
  },

  async createGroup(input: CreateGroupInput): Promise<GroupSnapshot> {
    const applicationId = await this.ensureApplicationId();
    const response = await this.db.createGroup({
      applicationId,
      name: input.name,
      description: input.description ?? "",
    });
    if (response.status?.code !== "OK" || !response.group) {
      throw new Error(response.status?.message || "Failed to create group");
    }
    const snapshot = groupToSnapshot(response.group);
    void this.emitGroupWebhook({
      type: EngineEventType.GROUP_CREATED,
      applicationId,
      correlationKey: input.correlationKey,
      group: snapshot,
    });
    return snapshot;
  },

  async updateGroup(id: string, input: UpdateGroupInput): Promise<GroupSnapshot> {
    const response = await this.db.updateGroup({
      id,
      name: input.name,
      description: input.description ?? "",
    });
    if (response.status?.code !== "OK" || !response.group) {
      throw new Error(response.status?.message || "Failed to update group");
    }
    const snapshot = groupToSnapshot(response.group);
    void this.emitGroupWebhook({
      type: EngineEventType.GROUP_UPDATED,
      applicationId: snapshot.applicationId,
      correlationKey: input.correlationKey,
      group: snapshot,
    });
    return snapshot;
  },

  async deleteGroup(id: string, correlationKey?: string): Promise<{ deleted: boolean }> {
    const applicationId = await this.ensureApplicationId();
    const status = await this.db.deleteGroup({ id });
    if (status.code !== "OK") {
      throw new Error(status.message || "Failed to delete group");
    }
    void this.emitGroupWebhook({
      type: EngineEventType.GROUP_DELETED,
      applicationId,
      correlationKey,
      groupId: id,
    });
    return { deleted: true };
  },

  async listGroupMembers(groupId: string): Promise<string[]> {
    const response = await this.db.listGroupMembers({ groupId });
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to list group members");
    }
    return response.usernames ?? [];
  },

  async addUserToGroup(groupId: string, username: string): Promise<{ ok: true }> {
    const applicationId = await this.ensureApplicationId();
    const status = await this.db.addUserToGroup({ applicationId, groupId, username });
    if (status.code !== "OK") {
      throw new Error(status.message || "Failed to add user to group");
    }
    void this.emitGroupWebhook({
      type: EngineEventType.GROUP_MEMBER_ADDED,
      applicationId,
      groupId,
      username,
    });
    return { ok: true };
  },

  async removeUserFromGroup(groupId: string, username: string): Promise<{ ok: true }> {
    const applicationId = await this.ensureApplicationId();
    const status = await this.db.removeUserFromGroup({ applicationId, groupId, username });
    if (status.code !== "OK") {
      throw new Error(status.message || "Failed to remove user from group");
    }
    void this.emitGroupWebhook({
      type: EngineEventType.GROUP_MEMBER_REMOVED,
      applicationId,
      groupId,
      username,
    });
    return { ok: true };
  },
};
