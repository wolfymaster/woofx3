import { describe, expect, test } from "bun:test";
import Commands from "./commands";

describe("Commands", () => {
  test("exposes stable string constants for event and reward routing", () => {
    expect(Commands.USER_BANNED).toBe("user_banned");
    expect(Commands.USER_FOLLOW).toBe("user_follow");
    expect(Commands.REWARD.BITS).toBe("bits");
  });
});
