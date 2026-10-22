// Fakes shared by the chat dispatcher's tests. Not imported by the dispatcher.
import type { PlatformId } from "@woofx3/api/platform-gateway";
import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";
import type { DispatcherDb, PermissionDecision, StoredCommand } from "./db-client";
import type { ChatLine } from "./trust";
import { viewerKey } from "./viewer";

export const NO_ROLES: ChatterMembership = {
  isBroadcaster: false,
  isModerator: false,
  isSubscriber: false,
  isVip: false,
};

export const BROADCASTER: ChatterMembership = { ...NO_ROLES, isBroadcaster: true };
export const MODERATOR: ChatterMembership = { ...NO_ROLES, isModerator: true };

export function storedCommand(overrides: Partial<StoredCommand> = {}): StoredCommand {
  return {
    id: "c-1",
    command: "hug",
    actionsJson: "",
    cooldown: 0,
    priority: 0,
    enabled: true,
    createdAt: { seconds: 0n, nanos: 0 },
    createdByType: "",
    createdByRef: "",
    visibility: "public",
    groupIds: [],
    usernames: [],
    argumentPattern: "",
    workflowId: "",
    stepsJson: "[]",
    workflowError: "",
    ...overrides,
  };
}

/** A trusted line from `platformUserId`, as the trust rules would read it. */
export function chatLine(
  overrides: Partial<ChatLine> & { platformUserId?: string; platform?: PlatformId } = {}
): ChatLine {
  const { platformUserId = "v-1", platform = "twitch", ...rest } = overrides;
  return {
    platform,
    viewer: viewerKey(platform, platformUserId),
    chatterLogin: "viewer",
    chatterName: "Viewer",
    text: "!hug",
    messageId: "m-1",
    lineId: "m-1",
    trusted: true,
    membership: NO_ROLES,
    sharedChat: false,
    ...rest,
  };
}

/** An in-memory db-proxy. Grants are `${username} ${resource}`; groups are seeded built-ins. */
export class FakeDispatcherDb implements DispatcherDb {
  commands: StoredCommand[] = [];
  readonly grants = new Set<string>();
  readonly groups = new Map<string, string>([
    ["subscriber", "g-sub"],
    ["vip", "g-vip"],
    ["moderator", "g-mod"],
    ["broadcaster", "g-bc"],
    ["subscriber_tier1", "g-t1"],
    ["subscriber_tier2", "g-t2"],
    ["subscriber_tier3", "g-t3"],
  ]);
  readonly memberships = new Set<string>();
  readonly writes: Array<{ op: "add" | "remove"; groupId: string; username: string }> = [];
  permissionChecks: Array<{ username: string; resource: string }> = [];
  listings = 0;
  groupListings = 0;
  /** When set, the next listing waits for this before answering. */
  listGate: Promise<void> | undefined;
  failListing = false;
  failPermission = false;
  failWrites = false;

  async listCommands(): Promise<StoredCommand[]> {
    this.listings++;
    const answer = this.commands;
    const gate = this.listGate;
    this.listGate = undefined;
    if (gate !== undefined) {
      await gate;
    }
    if (this.failListing) {
      throw new Error("db-proxy ListCommands: INTERNAL: down");
    }
    return answer;
  }

  async hasPermission(username: string, resource: string): Promise<PermissionDecision> {
    this.permissionChecks.push({ username, resource });
    if (this.failPermission) {
      throw new Error("db-proxy HasPermission: INTERNAL: down");
    }
    return this.grants.has(`${username} ${resource}`) ? "granted" : "denied";
  }

  async listBuiltInGroups(): Promise<Map<string, string>> {
    this.groupListings++;
    return new Map(this.groups);
  }

  async addUserToGroup(groupId: string, username: string): Promise<void> {
    if (this.failWrites) {
      throw new Error("db-proxy AddUserToGroup: INTERNAL: down");
    }
    this.writes.push({ op: "add", groupId, username });
    this.memberships.add(`${groupId} ${username}`);
  }

  async removeUserFromGroup(groupId: string, username: string): Promise<void> {
    if (this.failWrites) {
      throw new Error("db-proxy RemoveUserFromGroup: INTERNAL: down");
    }
    this.writes.push({ op: "remove", groupId, username });
    this.memberships.delete(`${groupId} ${username}`);
  }
}
