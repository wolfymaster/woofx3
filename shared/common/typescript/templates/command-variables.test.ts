import { describe, expect, test } from "bun:test";
import {
  extractCommandVariables,
  invalidCommandVariableNames,
  isValidVariableName,
  parseCommandVariables,
} from "./command-variables";

describe("parseCommandVariables", () => {
  test("returns [] for an empty pattern", () => {
    expect(parseCommandVariables("")).toEqual([]);
  });
  test("parses a single variable", () => {
    expect(parseCommandVariables("{songTitle}")).toEqual(["songTitle"]);
  });
  test("parses multiple variables in order", () => {
    expect(parseCommandVariables("{userA} {userB}")).toEqual(["userA", "userB"]);
  });
});

describe("isValidVariableName / invalidCommandVariableNames", () => {
  test("accepts a single word", () => {
    expect(isValidVariableName("songTitle")).toBe(true);
  });
  test("accepts dot-separated words", () => {
    expect(isValidVariableName("user.name")).toBe(true);
  });
  test("rejects spaces, brackets, and other punctuation", () => {
    expect(isValidVariableName("song title")).toBe(false);
    expect(isValidVariableName("song-title")).toBe(false);
    expect(isValidVariableName("song[0]")).toBe(false);
    expect(isValidVariableName("")).toBe(false);
    expect(isValidVariableName(".name")).toBe(false);
    expect(isValidVariableName("name.")).toBe(false);
  });
  test("invalidCommandVariableNames flags only the bad ones", () => {
    expect(invalidCommandVariableNames("{userA} {user b}")).toEqual(["user b"]);
    expect(invalidCommandVariableNames("{userA} {userB}")).toEqual([]);
  });
});

describe("extractCommandVariables", () => {
  test("returns {} when no variables are declared", () => {
    expect(extractCommandVariables([], "anything here")).toEqual({});
  });

  test("a single variable captures the entire trimmed remainder", () => {
    expect(extractCommandVariables(["songTitle"], "  Life is a highway  ")).toEqual({
      songTitle: "Life is a highway",
    });
  });

  test("multiple variables: all but the last take one token each", () => {
    expect(extractCommandVariables(["userA", "userB"], "alice bob")).toEqual({
      userA: "alice",
      userB: "bob",
    });
  });

  test("the last variable rejoins every remaining token", () => {
    expect(extractCommandVariables(["userA", "userB"], "alice bob smith")).toEqual({
      userA: "alice",
      userB: "bob smith",
    });
  });

  test("missing trailing tokens resolve to empty string", () => {
    expect(extractCommandVariables(["userA", "userB"], "alice")).toEqual({
      userA: "alice",
      userB: "",
    });
    expect(extractCommandVariables(["userA", "userB"], "")).toEqual({
      userA: "",
      userB: "",
    });
  });

  test("dot-separated names build a nested object", () => {
    expect(extractCommandVariables(["user.name"], "wolfy")).toEqual({
      user: { name: "wolfy" },
    });
  });

  test("multiple dotted names under the same root merge into one object", () => {
    expect(extractCommandVariables(["user.first", "user.last"], "Wolfy Master")).toEqual({
      user: { first: "Wolfy", last: "Master" },
    });
  });
});
