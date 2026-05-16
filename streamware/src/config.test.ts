import { describe, expect, test } from "bun:test";
import { StreamwareEnvSchema } from "./config";

const baseValid = {
  woofx3StreamwarePort: "9101",
  woofx3MessagebusUrl: "ws://localhost:4225",
  woofx3ObsHost: "127.0.0.1",
  woofx3ObsPort: "4455",
  woofx3DatabaseProxyUrl: "http://localhost:5555",
};

describe("StreamwareEnvSchema", () => {
  test("accepts a complete configuration object", () => {
    const parsed = StreamwareEnvSchema.safeParse(baseValid);
    expect(parsed.success).toBe(true);
  });

  test("applies defaults for optional fields", () => {
    const parsed = StreamwareEnvSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.woofx3StreamwarePort).toBe("9101");
      expect(parsed.data.woofx3MessagebusUrl).toBe("ws://localhost:4225");
      expect(parsed.data.woofx3ObsHost).toBe("127.0.0.1");
      expect(parsed.data.woofx3ObsPort).toBe("4455");
    }
  });

  test("accepts alternative env var names", () => {
    const parsed = StreamwareEnvSchema.safeParse({
      streamwarePort: "9102",
      messagebusUrl: "ws://localhost:4226",
      obsHost: "localhost",
      obsPort: "4456",
      databaseProxyUrl: "http://localhost:5556",
    });
    expect(parsed.success).toBe(true);
  });

  test("accepts numeric port values", () => {
    const parsed = StreamwareEnvSchema.safeParse({
      woofx3StreamwarePort: 9101,
      woofx3ObsPort: 4455,
    });
    expect(parsed.success).toBe(true);
  });
});