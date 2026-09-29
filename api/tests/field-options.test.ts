import { describe, expect, it } from "bun:test";
import { fieldOptionsReplyError } from "../src/routes/field-options";

describe("fieldOptionsReplyError", () => {
  it("reads the reason from a worker's { error } reply", () => {
    expect(fieldOptionsReplyError({ error: "OBS is not connected (retrying)" })).toBe(
      "OBS is not connected (retrying)"
    );
  });

  it("treats options, and anything without a reason, as a successful reply", () => {
    expect(fieldOptionsReplyError([{ value: "Main", label: "Main" }])).toBeNull();
    expect(fieldOptionsReplyError([])).toBeNull();
    expect(fieldOptionsReplyError({ items: [] })).toBeNull();
    expect(fieldOptionsReplyError({ error: "" })).toBeNull();
    expect(fieldOptionsReplyError("text")).toBeNull();
    expect(fieldOptionsReplyError(null)).toBeNull();
  });
});
