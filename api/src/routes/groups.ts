import { routeModule } from "./context";
import type {
  CreateGroupInput,
  GroupSnapshot,
  ListPermissionsQuery,
  PermissionRule,
  UpdateGroupInput,
} from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";

function groupToSnapshot(g: {
  id: string;
  applicationId: string;
  name: string;
  description: string;
  createdAt: unknown;
  isBuiltIn?: boolean;
}): GroupSnapshot {
  return {
    id: g.id,
    applicationId: g.applicationId,
    name: g.name,
    description: g.description,
    isBuiltIn: g.isBuiltIn ?? false,
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
export const groupsRoutes = routeModule({
  async listGroups(): Promise<GroupSnapshot[]> {
    const applicationId = await this.ensureApplicationId();
    const groups = await this.db.listGroups({ applicationId });
    return groups.map(groupToSnapshot);
  },

  async createGroup(input: CreateGroupInput): Promise<GroupSnapshot> {
    const applicationId = await this.ensureApplicationId();
    const group = await this.db.createGroup({
      applicationId,
      name: input.name,
      description: input.description ?? "",
    });
    const snapshot = groupToSnapshot(group);
    void this.emitGroupWebhook({
      type: EngineEventType.GROUP_CREATED,
      applicationId,
      correlationKey: input.correlationKey,
      group: snapshot,
    });
    return snapshot;
  },

  async updateGroup(id: string, input: UpdateGroupInput): Promise<GroupSnapshot> {
    const group = await this.db.updateGroup({
      id,
      name: input.name,
      description: input.description ?? "",
    });
    const snapshot = groupToSnapshot(group);
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
    await this.db.deleteGroup({ id });
    void this.emitGroupWebhook({
      type: EngineEventType.GROUP_DELETED,
      applicationId,
      correlationKey,
      groupId: id,
    });
    return { deleted: true };
  },

  async listGroupMembers(groupId: string): Promise<string[]> {
    return this.db.listGroupMembers({ groupId });
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

  async listGroupsForUser(username: string): Promise<GroupSnapshot[]> {
    const applicationId = await this.ensureApplicationId();
    const groups = await this.db.listUserGroupsForUser({ applicationId, username });
    return groups.map(groupToSnapshot);
  },

  async listPermissions(query: ListPermissionsQuery = {}): Promise<PermissionRule[]> {
    const applicationId = await this.ensureApplicationId();
    const response = await this.db.listPermissions({
      applicationId,
      ptype: query.ptype ?? "",
      ptypePrefix: query.ptypePrefix ?? "",
      subject: query.subject ?? "",
    });
    return response.map((p) => ({
      id: Number(p.id),
      applicationId: p.applicationId,
      ptype: p.ptype,
      v0: p.v0,
      v1: p.v1,
      v2: p.v2,
      v3: p.v3,
      v4: p.v4,
      v5: p.v5,
    }));
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
});
