import { afterEach, describe, expect, test } from "bun:test";
import { countingIds, FakeTime, halfRandom } from "../../host/testing";
import { KickAdapter, kickHostState } from "./adapter";
import { type FakeKickServer, startFakeKick } from "./fake-kick-server";
import { KickTokenBus, kickConfigAt, supervisedKick } from "./testing";

let kick: FakeKickServer;

afterEach(async () => {
  await kick.stop();
});

async function running() {
  kick = startFakeKick();
  const time = new FakeTime(Date.now());
  const deps = {
    config: kickConfigAt(kick.url),
    clock: time,
    timers: time,
    random: halfRandom,
    ids: countingIds(),
    fetch,
  };
  const adapter = new KickAdapter(deps, kickHostState(deps));
  const supervised = supervisedKick(adapter, new KickTokenBus(), time);
  await supervised.apply(true, true);
  const served = adapter.manifest.serves.find((s) => s.subject === "kickapi");
  if (served === undefined) {
    throw new Error("the adapter does not serve kickapi");
  }
  const ask = async (command: string, args?: Record<string, unknown>, deadline = time.now() + 9_000) => {
    const reply = await served.handle(new TextEncoder().encode(JSON.stringify({ command, args })), {
      deadline,
      signal: new AbortController().signal,
      hostState: kickHostState(deps),
    });
    return JSON.parse(new TextDecoder().decode(reply)) as {
      type: string;
      source: string;
      data: unknown;
    };
  };
  const writes = () => kick.requests.filter((r) => r.method !== "GET" && r.path !== "/public/v1/events/subscriptions");
  return { served, ask, writes, time, ...supervised };
}

describe("kickapi", () => {
  const users: [name: string, args: Record<string, unknown>][] = [
    ["by id", { userId: "777" }],
    ["by slug, as typed in chat", { userName: "@Pup-Pal" }],
    ["by display name, as a trigger's chatterName carries it", { userName: "Pup_Pal" }],
  ];
  for (const [name, args] of users) {
    test(`getUser ${name}`, async () => {
      const { ask } = await running();
      expect(await ask("getUser", args)).toMatchObject({
        type: "kickapi.getUser.result",
        source: "kickapi",
        data: {
          userId: "777",
          login: "pup-pal",
          displayName: "Pup_Pal",
          profileImageUrl: "https://files.kick.com/pup.png",
          title: "pup stream",
          categoryId: "101",
          categoryName: "Minecraft",
          tags: ["cozy"],
          isLive: true,
          viewerCount: 12,
          streamStartedAt: "2026-11-25T09:00:00Z",
        },
      });
    });
  }

  const refused: [name: string, command: string, args: Record<string, unknown>][] = [
    ["an unknown slug", "getUser", { userName: "nobody" }],
    ["both an id and a slug", "getUser", { userId: "1", userName: "x" }],
    ["a non-numeric id", "getUser", { userId: "abc" }],
    ["a category Kick does not have", "updateStream", { category: "chess" }],
    ["eleven tags", "updateStream", { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ["nothing to change", "updateStream", {}],
    ["a timeout above 7 days", "timeout", { userId: "777", durationSeconds: 604_801 }],
    ["a timeout of the broadcaster", "timeout", { userId: "4242", durationSeconds: 60 }],
    ["a reason longer than Kick takes", "timeout", { userId: "777", durationSeconds: 60, reason: "x".repeat(101) }],
  ];
  for (const [name, command, args] of refused) {
    test(`${command} refuses ${name} as invalid_arguments, changing nothing`, async () => {
      const { ask, writes } = await running();
      expect(await ask(command, args)).toMatchObject({ type: "kickapi.error", data: { code: "invalid_arguments" } });
      expect(writes()).toEqual([]);
    });
  }

  test("updateStream changes only the title when only a title is given", async () => {
    const { ask, writes } = await running();
    expect((await ask("updateStream", { title: "new title" })).data).toEqual({ title: "new title" });
    expect(writes().map((w) => w.body)).toEqual([{ stream_title: "new title" }]);
  });

  test("updateStream turns a category name into Kick's category id", async () => {
    const { ask, writes } = await running();
    expect((await ask("updateStream", { category: "minecraft" })).data).toEqual({
      categoryId: "101",
      categoryName: "Minecraft",
    });
    expect(writes().map((w) => w.body)).toEqual([{ category_id: 101 }]);
  });

  test("timeout by display name finds the chatter's id", async () => {
    const { ask } = await running();
    expect((await ask("timeout", { userName: "@Pup_Pal", durationSeconds: 60 })).data).toEqual({
      userId: "777",
      durationSeconds: 60,
    });
  });

  test("timeout by slug rounds up to whole minutes and reports what was applied", async () => {
    const { ask } = await running();
    expect((await ask("timeout", { userName: "pup-pal", durationSeconds: 61 })).data).toEqual({
      userId: "777",
      durationSeconds: 120,
    });
    expect(kick.state.bans).toEqual([{ broadcaster_user_id: 4242, user_id: 777, duration: 2 }]);
  });

  test("listRewards answers as a picker's options", async () => {
    const { ask } = await running();
    expect((await ask("listRewards")).data).toEqual([{ value: "01REWARD", label: "Hydrate" }]);
  });

  test("a command whose deadline has passed sends nothing to Kick", async () => {
    const { ask, time } = await running();
    const before = kick.requests.length;
    expect(await ask("timeout", { userId: "777", durationSeconds: 60 }, time.now() - 1)).toMatchObject({
      type: "kickapi.error",
    });
    expect(kick.requests.length).toBe(before);
  });

  test("a slow Kick ends the command at its deadline, not after stacked timeouts", async () => {
    const { ask, time } = await running();
    kick.route("GET", "/public/v1/channels", () => new Promise<Response>(() => {}));
    const started = Date.now();
    const reply = await ask("getUser", { userName: "pup-pal" }, time.now() + 150);
    expect(reply).toMatchObject({ type: "kickapi.error" });
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  test("an unknown command is refused without a code", async () => {
    const { ask } = await running();
    expect(await ask("helix", {})).toMatchObject({ type: "kickapi.error", data: { error: "Unknown command: helix" } });
  });

  const unavailable: [name: string, link: { connected: boolean; enabled: boolean } | null, code: string][] = [
    ["no account linked", { connected: false, enabled: false }, "not_linked"],
    ["linked but turned off", { connected: true, enabled: false }, "integration_unavailable"],
    ["a link not read yet", null, "integration_unavailable"],
  ];
  for (const [name, link, code] of unavailable) {
    test(`while ${name}, the host answers ${code}`, async () => {
      const { served } = await running();
      const reply = JSON.parse(new TextDecoder().decode(served.unavailableReply({ reason: "stopped", link })));
      expect(reply).toMatchObject({ type: "kickapi.error", source: "kickapi", data: { code } });
    });
  }
});
