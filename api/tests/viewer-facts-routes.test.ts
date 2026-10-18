import { describe, expect, test } from "bun:test";
import type * as viewer_fact from "@woofx3/db/viewer_fact.pb";
import { viewerFactPath, viewerFactsRoutes } from "../src/routes/viewer-facts";

function definition(overrides: Partial<viewer_fact.FactDefinition>): viewer_fact.FactDefinition {
  return {
    id: "user:fact:messages",
    name: "Messages",
    description: "Chat messages sent.",
    definition: "{}",
    valueKind: "number",
    windowKind: "lifetime",
    revision: 1n,
    createdByType: "USER",
    createdByRef: "",
    countingSince: { seconds: 0n, nanos: 0 },
    backfilledThrough: undefined,
    createdAt: { seconds: 0n, nanos: 0 },
    updatedAt: { seconds: 0n, nanos: 0 },
    status: "active",
    reason: "",
    sources: [],
    aggregate: "count",
    ...overrides,
  } as viewer_fact.FactDefinition;
}

/** The route touches only `db`, so that is all the host needs here. */
function list(definitions: viewer_fact.FactDefinition[]) {
  const route = viewerFactsRoutes.listViewerFacts as unknown as () => Promise<unknown>;
  return route.call({
    db: {
      async listFactDefinitions() {
        return definitions;
      },
    },
  });
}

describe("listViewerFacts", () => {
  test("lists the viewer's id, platform and name before the facts", async () => {
    const facts = (await list([])) as { path: string }[];

    expect(facts.map((fact) => fact.path)).toEqual(["id", "platform", "name"]);
  });

  test("places each active fact at {owner}.{slug}, in path order, with its kind and window", async () => {
    const facts = await list([
      definition({ id: "woofx3:fact:last_seen", name: "Last seen", valueKind: "timestamp", description: "" }),
      definition({ id: "user:fact:session_cheers", name: "Bits this stream", windowKind: "session" }),
    ]);

    expect(facts).toEqual([
      expect.objectContaining({ path: "id" }),
      expect.objectContaining({ path: "platform" }),
      expect.objectContaining({ path: "name" }),
      {
        path: "user.session_cheers",
        name: "Bits this stream",
        description: "Chat messages sent.",
        valueKind: "number",
        window: "session",
      },
      { path: "woofx3.last_seen", name: "Last seen", description: "", valueKind: "timestamp", window: "lifetime" },
    ]);
  });

  // The engine reads active facts only: one that stopped counting holds a stale value.
  test("leaves out a fact that is not active", async () => {
    const facts = (await list([
      definition({ id: "user:fact:a", status: "unresolved" }),
      definition({ id: "user:fact:b", status: "invalid" }),
    ])) as unknown[];

    expect(facts).toHaveLength(3);
  });

  test("leaves out a fact with an unknown kind or window", async () => {
    const facts = (await list([
      definition({ id: "user:fact:a", valueKind: "duration" }),
      definition({ id: "user:fact:b", windowKind: "forever" }),
    ])) as unknown[];

    expect(facts).toHaveLength(3);
  });

  test("names a fact by its path when it has no name", async () => {
    const facts = (await list([definition({ id: "user:fact:streak", name: "" })])) as { name: string }[];

    expect(facts[3].name).toBe("user.streak");
  });

  test("fails when db-proxy cannot list the definitions", async () => {
    const route = viewerFactsRoutes.listViewerFacts as unknown as () => Promise<unknown>;
    const failing = route.call({
      db: {
        async listFactDefinitions() {
          throw new Error("unreachable");
        },
      },
    });

    await expect(failing).rejects.toThrow("unreachable");
  });
});

describe("viewerFactPath", () => {
  test.each([
    ["user:fact:messages", "user.messages"],
    ["woofx3:fact:last_seen", "woofx3.last_seen"],
  ])("places %s at %s", (id, path) => {
    expect(viewerFactPath(id)).toBe(path);
  });

  // Must match addFactValues in workflow/viewer_resolver.go.
  test.each([
    ["an owner that is a reserved key", "name:fact:anything"],
    ["a segment id", "user:segment:superfans"],
    ["too few parts", "user:messages"],
    ["too many parts", "user:fact:a:b"],
    ["an empty owner", ":fact:messages"],
    ["an empty slug", "user:fact:"],
  ])("has no path for %s", (_label, id) => {
    expect(viewerFactPath(id)).toBeNull();
  });
});
