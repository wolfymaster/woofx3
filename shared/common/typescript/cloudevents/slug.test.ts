import { describe, test, expect } from "bun:test";
import { commandNameToSubjectSegment } from "./slug";

describe("commandNameToSubjectSegment", () => {
  test("strips leading exclamation and lowercases", () => {
    expect(commandNameToSubjectSegment("!Hello")).toBe("hello");
  });
  test("leaves already-clean names alone (lowercase)", () => {
    expect(commandNameToSubjectSegment("hello")).toBe("hello");
  });
  test("throws on NATS-reserved characters", () => {
    expect(() => commandNameToSubjectSegment("!foo.bar")).toThrow();
    expect(() => commandNameToSubjectSegment("!foo*")).toThrow();
    expect(() => commandNameToSubjectSegment("!foo>")).toThrow();
    expect(() => commandNameToSubjectSegment("!foo bar")).toThrow();
  });
  test("throws on empty input", () => {
    expect(() => commandNameToSubjectSegment("")).toThrow();
    expect(() => commandNameToSubjectSegment("!")).toThrow();
  });
});
