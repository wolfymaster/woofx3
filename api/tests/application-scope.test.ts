import { describe, expect, it, mock } from "bun:test";
import { ApplicationScope } from "../src/application-scope";

function logger() {
  return { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never;
}

describe("ApplicationScope", () => {
  it("starts the components once for an application", async () => {
    const startComponents = mock(async (_applicationId: string) => {});
    const scope = new ApplicationScope(startComponents, logger());

    await scope.start("app-1");
    await scope.start("app-1");

    expect(startComponents).toHaveBeenCalledTimes(1);
    expect(startComponents).toHaveBeenCalledWith("app-1");
  });

  it("shares one start between concurrent callers", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startComponents = mock(async (_applicationId: string) => {
      await gate;
    });
    const scope = new ApplicationScope(startComponents, logger());

    const first = scope.start("app-1");
    const second = scope.start("app-1");
    release();
    await Promise.all([first, second]);

    expect(startComponents).toHaveBeenCalledTimes(1);
  });

  it("refuses to start for a second, different application", async () => {
    const scope = new ApplicationScope(async () => {}, logger());
    await scope.start("app-1");

    await expect(scope.start("app-2")).rejects.toThrow("refusing to start them for app-2");
  });

  it("tries again after a start that failed", async () => {
    let attempts = 0;
    const scope = new ApplicationScope(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("NATS not ready");
      }
    }, logger());

    await expect(scope.start("app-1")).rejects.toThrow("NATS not ready");
    await scope.start("app-1");

    expect(attempts).toBe(2);
  });
});
