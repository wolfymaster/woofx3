import { type Command, ListCommands } from "@woofx3/db/command.pb";
import type { ResponseStatus } from "@woofx3/db/common.pb";
import { AddUserToGroup, ListGroups, RemoveUserFromGroup } from "@woofx3/db/group.pb";
import { HasPermission } from "@woofx3/db/permission.pb";
import type { DbProxyClientConfig } from "../services/db-proxy";

export type StoredCommand = Command;

/** A permission decision; anything but these two is an error, not a refusal. */
export type PermissionDecision = "granted" | "denied";

/**
 * The db-proxy calls the dispatcher makes, each one either answering or
 * throwing with db-proxy's status. Tests pass an in-memory fake.
 */
export interface DispatcherDb {
  /** Every enabled stored command. */
  listCommands(): Promise<StoredCommand[]>;
  hasPermission(username: string, resource: string, action: string): Promise<PermissionDecision>;
  /** Built-in group ids by group name. */
  listBuiltInGroups(): Promise<Map<string, string>>;
  addUserToGroup(groupId: string, username: string): Promise<void>;
  removeUserFromGroup(groupId: string, username: string): Promise<void>;
}

/** The dispatcher's db-proxy client. Built once and shared by every part of the dispatcher. */
export function dbProxyDispatcherDb(config: DbProxyClientConfig): DispatcherDb {
  return {
    listCommands: async () => {
      const response = await ListCommands({ includeDisabled: false }, config);
      requireOk("ListCommands", response.status);
      return response.commands;
    },
    hasPermission: async (username, resource, action) => {
      const status = await HasPermission({ username, resource, action }, config);
      if (status.code === "OK") {
        return "granted";
      }
      if (status.code === "PERMISSION_DENIED") {
        return "denied";
      }
      throw statusError("HasPermission", status);
    },
    listBuiltInGroups: async () => {
      const response = await ListGroups({}, config);
      requireOk("ListGroups", response.status);
      const ids = new Map<string, string>();
      for (const group of response.groups) {
        if (group.isBuiltIn) {
          ids.set(group.name, group.id);
        }
      }
      return ids;
    },
    addUserToGroup: async (groupId, username) => {
      requireOk("AddUserToGroup", await AddUserToGroup({ groupId, username }, config));
    },
    removeUserFromGroup: async (groupId, username) => {
      requireOk("RemoveUserFromGroup", await RemoveUserFromGroup({ groupId, username }, config));
    },
  };
}

function requireOk(operation: string, status: ResponseStatus | undefined): void {
  if (status?.code !== "OK") {
    throw statusError(operation, status);
  }
}

function statusError(operation: string, status: ResponseStatus | undefined): Error {
  return new Error(`db-proxy ${operation}: ${status?.code ?? "no status"}: ${status?.message ?? ""}`);
}
