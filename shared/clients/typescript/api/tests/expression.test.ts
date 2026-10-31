import { describe, expect, test } from "bun:test";
import { EXPRESSION_FUNCTIONS, functionCallProblem } from "../expression";
import conformance from "./expression-conformance.json";

describe("expression functions", () => {
  test("the function set matches the conformance file", () => {
    expect(EXPRESSION_FUNCTIONS).toEqual(conformance.functions);
  });

  for (const text of conformance.valid) {
    test(`accepts ${text}`, () => {
      expect(functionCallProblem(text)).toBeNull();
    });
  }

  for (const text of conformance.invalid) {
    test(`refuses ${text}`, () => {
      expect(functionCallProblem(text)).not.toBeNull();
    });
  }

  test("names the problem", () => {
    expect(functionCallProblem("${foo(1)}")).toBe('${foo(1)}: unknown function "foo"');
    expect(functionCallProblem("${add(1)}")).toBe("${add(1)}: add takes at least 2 arguments, got 1");
  });
});
