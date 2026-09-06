import { describe, expect, it, mock } from "bun:test";
import { Api } from "../src/api";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

/**
 * NATS stand-in that records every publish. `executeCommand` must never reach
 * this for a denied command - that is the whole point of the assertion.
 */
function recordingNats() {
  const published: string[] = [];
  return {
    published,
    client: {
      publish: mock((subject: string) => {
        published.push(subject);
      }),
    },
  };
}

function makeApi(db: any) {
  const nats = recordingNats();
  const api = new Api({
    db,
    nats: nats.client,
    barkloaderUrl: "http://barkloader.local",
    logger: fakeLogger(),
  });
  return { api, nats };
}

const APPLICATION = { id: "app-1" };

function commandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmd-1",
    applicationId: APPLICATION.id,
    command: "song",
    type: "text",
    typeValue: "now playing",
    cooldown: 0,
    priority: 0,
    enabled: true,
    visibility: "restricted",
    groupIds: [] as string[],
    usernames: [] as string[],
    argumentPattern: "",
    ...overrides,
  };
}

describe("executeCommand permission enforcement", () => {
  // The no-regression case: a command with no group restriction must execute
  // for any user exactly as it did before group binding existed.
  it("executes a command that has no group restriction", async () => {
    const getCommand = mock(async () => ({
      status: { code: "OK" },
      command: commandRow({ groupIds: [] }),
    }));
    const { api, nats } = makeApi({
      getDefaultApplication: mock(async () => APPLICATION),
      getCommand,
    });

    const result = await api.executeCommand("song", "randomchatter");

    expect(result.success).toBe(true);
    expect(nats.published).toContain("command.execute");
    // The invoking username must be forwarded so db-proxy can make the call.
    expect(getCommand.mock.calls[0][0]).toMatchObject({
      command: "song",
      username: "randomchatter",
    });
  });

  it("executes a command whose required group the user belongs to", async () => {
    const { api, nats } = makeApi({
      getDefaultApplication: mock(async () => APPLICATION),
      // db-proxy already enforced the grant and returned the command, which is
      // exactly what an authorized call looks like from this side.
      getCommand: mock(async () => ({
        status: { code: "OK" },
        command: commandRow({ command: "vanish", groupIds: ["group-mods"] }),
      })),
    });

    const result = await api.executeCommand("vanish", "trustedmod");

    expect(result.success).toBe(true);
    expect(nats.published).toContain("command.execute");
  });

  it("refuses to publish command.execute when db-proxy denies the user", async () => {
    const { api, nats } = makeApi({
      getDefaultApplication: mock(async () => APPLICATION),
      getCommand: mock(async () => {
        throw new Error("db.getCommand: unauthenticated: unauthorized");
      }),
    });

    await expect(api.executeCommand("vanish", "randomchatter")).rejects.toThrow(
      /do not have permission/i
    );
    expect(nats.published).not.toContain("command.execute");
  });

  it("surfaces a transport failure as itself rather than as a denial", async () => {
    const { api, nats } = makeApi({
      getDefaultApplication: mock(async () => APPLICATION),
      getCommand: mock(async () => {
        throw new Error("db.getCommand: connection refused");
      }),
    });

    await expect(api.executeCommand("song", "randomchatter")).rejects.toThrow(/connection refused/);
    expect(nats.published).not.toContain("command.execute");
  });

  it("does not publish for a disabled command", async () => {
    const { api, nats } = makeApi({
      getDefaultApplication: mock(async () => APPLICATION),
      getCommand: mock(async () => ({
        status: { code: "OK" },
        command: commandRow({ enabled: false }),
      })),
    });

    await expect(api.executeCommand("song", "randomchatter")).rejects.toThrow(/disabled/i);
    expect(nats.published).not.toContain("command.execute");
  });
});

describe("group routes", () => {
  it("marks built-in groups on the snapshot so a UI can disable edit affordances", async () => {
    const { api } = makeApi({
      getDefaultApplication: mock(async () => APPLICATION),
      listGroups: mock(async () => ({
        status: { code: "OK" },
        groups: [
          {
            id: "g-everyone",
            applicationId: APPLICATION.id,
            name: "everyone",
            description: "",
            createdAt: undefined,
            isBuiltIn: true,
          },
          {
            id: "g-regulars",
            applicationId: APPLICATION.id,
            name: "regulars",
            description: "",
            createdAt: undefined,
            isBuiltIn: false,
          },
        ],
      })),
    });

    const groups = await api.listGroups();

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ name: "everyone", isBuiltIn: true });
    expect(groups[1]).toMatchObject({ name: "regulars", isBuiltIn: false });
  });

  it("propagates the engine's refusal to delete a built-in group", async () => {
    const { api } = makeApi({
      getDefaultApplication: mock(async () => APPLICATION),
      deleteGroup: mock(async () => {
        throw new Error('db.deleteGroup: permission_denied: built-in group "moderator" cannot be deleted');
      }),
    });

    await expect(api.deleteGroup("g-moderator")).rejects.toThrow(/cannot be deleted/);
  });

  it("lists the groups a user belongs to", async () => {
    const listUserGroupsForUser = mock(async () => ({
      status: { code: "OK" },
      groups: [
        {
          id: "g-mods",
          applicationId: APPLICATION.id,
          name: "moderator",
          description: "",
          createdAt: undefined,
          isBuiltIn: true,
        },
      ],
    }));
    const { api } = makeApi({
      getDefaultApplication: mock(async () => APPLICATION),
      listUserGroupsForUser,
    });

    const groups = await api.listGroupsForUser("TrustedMod");

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ name: "moderator", isBuiltIn: true });
    expect(listUserGroupsForUser.mock.calls[0][0]).toMatchObject({ username: "TrustedMod" });
  });
});
