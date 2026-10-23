import { describe, expect, test } from "bun:test";
import { REFRESH_LATCH_CONSUMED_CAPACITY, RefreshLatch } from "./refresh-latch";

const request = (bootId: string, overlayPort = 9101) => ({ overlayPort, bootId });

describe("RefreshLatch", () => {
  test("hands a latched request to one taker, once", () => {
    const latch = new RefreshLatch();
    expect(latch.latch(request("boot-1"))).toBe("latched");
    expect(latch.take()).toEqual(request("boot-1"));
    expect(latch.take()).toBeNull();
  });

  test("keeps only the newest request waiting", () => {
    const latch = new RefreshLatch();
    latch.latch(request("boot-1"));
    latch.latch(request("boot-2", 9200));
    expect(latch.take()).toEqual(request("boot-2", 9200));
  });

  const repeats: Array<[name: string, arrange: (latch: RefreshLatch) => void]> = [
    ["waiting", (latch) => latch.latch(request("boot-1"))],
    [
      "being refreshed",
      (latch) => {
        latch.latch(request("boot-1"));
        latch.take();
      },
    ],
    [
      "consumed",
      (latch) => {
        latch.latch(request("boot-1"));
        const taken = latch.take();
        if (taken === null) {
          throw new Error("nothing to take");
        }
        latch.consume(taken);
      },
    ],
  ];
  for (const [state, arrange] of repeats) {
    test(`treats a boot id that is ${state} as a repeat that changes nothing`, () => {
      const latch = new RefreshLatch();
      arrange(latch);
      const heard: string[] = [];
      latch.onLatched(() => heard.push("latched"));
      expect(latch.latch(request("boot-1"))).toBe("repeat");
      expect(heard).toEqual([]);
    });
  }

  test("does not hand out a second request while one is being refreshed", () => {
    const latch = new RefreshLatch();
    latch.latch(request("boot-1"));
    latch.take();
    latch.latch(request("boot-2"));
    expect(latch.take()).toBeNull();
  });

  test("lets a request OBS was never asked about wait again", () => {
    const latch = new RefreshLatch();
    latch.latch(request("boot-1"));
    const taken = latch.take();
    if (taken === null) {
      throw new Error("nothing to take");
    }
    latch.release(taken);
    expect(latch.take()).toEqual(request("boot-1"));
  });

  test("prefers a request latched during the refresh over the one handed back", () => {
    const latch = new RefreshLatch();
    latch.latch(request("boot-1"));
    const taken = latch.take();
    if (taken === null) {
      throw new Error("nothing to take");
    }
    latch.latch(request("boot-2"));
    latch.release(taken);
    expect(latch.take()).toEqual(request("boot-2"));
  });

  test("tells its listener of every new request and of one handed back", () => {
    const latch = new RefreshLatch();
    const heard: number[] = [];
    latch.onLatched(() => heard.push(1));
    latch.latch(request("boot-1"));
    const taken = latch.take();
    if (taken === null) {
      throw new Error("nothing to take");
    }
    latch.release(taken);
    expect(heard).toHaveLength(2);
  });

  test("holds one listener at a time, and a removed one hears nothing", () => {
    const latch = new RefreshLatch();
    const heard: string[] = [];
    const remove = latch.onLatched(() => heard.push("first"));
    expect(() => latch.onLatched(() => heard.push("second"))).toThrow("already has a listener");
    remove();
    latch.onLatched(() => heard.push("second"));
    latch.latch(request("boot-1"));
    expect(heard).toEqual(["second"]);
  });

  test("forgets the oldest consumed boot id past its capacity", () => {
    const latch = new RefreshLatch();
    for (let index = 0; index <= REFRESH_LATCH_CONSUMED_CAPACITY; index += 1) {
      latch.latch(request(`boot-${index}`));
      const taken = latch.take();
      if (taken === null) {
        throw new Error("nothing to take");
      }
      latch.consume(taken);
    }
    expect(latch.latch(request("boot-0"))).toBe("latched");
    expect(latch.latch(request(`boot-${REFRESH_LATCH_CONSUMED_CAPACITY}`))).toBe("repeat");
  });

  test("refuses to settle a request it did not hand out", () => {
    const latch = new RefreshLatch();
    expect(() => latch.consume(request("boot-1"))).toThrow("was not taken");
    expect(() => latch.release(request("boot-1"))).toThrow("was not taken");
  });
});
