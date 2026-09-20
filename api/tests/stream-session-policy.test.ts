import { describe, expect, test } from "bun:test";
import { DEFAULT_SESSION_GRACE_MS, decideOnStreamOnline } from "../src/stream-session-policy";

const NOW = 1_000_000_000;
const GRACE = 60_000;

describe("decideOnStreamOnline", () => {
  test("extends when the stream is already live, so a redelivered notification is not a gap", () => {
    expect(decideOnStreamOnline({ isSegmentOpen: true }, NOW, GRACE)).toBe("extend");
  });

  test("a redelivered notification extends even with an old segment end recorded", () => {
    expect(decideOnStreamOnline({ isSegmentOpen: true, lastSegmentEndedAt: NOW - 10 * GRACE }, NOW, GRACE)).toBe(
      "extend"
    );
  });

  test("extends when the session has never been live", () => {
    expect(decideOnStreamOnline({ isSegmentOpen: false }, NOW, GRACE)).toBe("extend");
  });

  test("extends when the stream came back inside the grace window", () => {
    expect(decideOnStreamOnline({ isSegmentOpen: false, lastSegmentEndedAt: NOW - 1 }, NOW, GRACE)).toBe("extend");
  });

  test("extends at exactly the grace boundary", () => {
    expect(decideOnStreamOnline({ isSegmentOpen: false, lastSegmentEndedAt: NOW - GRACE }, NOW, GRACE)).toBe("extend");
  });

  test("splits one millisecond past the grace window", () => {
    expect(decideOnStreamOnline({ isSegmentOpen: false, lastSegmentEndedAt: NOW - GRACE - 1 }, NOW, GRACE)).toBe(
      "split"
    );
  });

  test("splits after a long break between broadcasts", () => {
    const yesterday = NOW - 24 * 60 * 60 * 1000;
    expect(decideOnStreamOnline({ isSegmentOpen: false, lastSegmentEndedAt: yesterday }, NOW, GRACE)).toBe("split");
  });

  test("a backwards clock extends rather than splitting mid-stream", () => {
    // An NTP correction, or a segment end stamped from an event's own time.
    expect(decideOnStreamOnline({ isSegmentOpen: false, lastSegmentEndedAt: NOW + 5_000 }, NOW, GRACE)).toBe("extend");
  });

  test("a zero grace window splits on any measurable gap but not on an instant return", () => {
    expect(decideOnStreamOnline({ isSegmentOpen: false, lastSegmentEndedAt: NOW }, NOW, 0)).toBe("extend");
    expect(decideOnStreamOnline({ isSegmentOpen: false, lastSegmentEndedAt: NOW - 1 }, NOW, 0)).toBe("split");
  });

  test("falls back to the default grace when none is given", () => {
    const state = { isSegmentOpen: false, lastSegmentEndedAt: NOW - DEFAULT_SESSION_GRACE_MS };
    expect(decideOnStreamOnline(state, NOW)).toBe("extend");
    expect(decideOnStreamOnline({ ...state, lastSegmentEndedAt: NOW - DEFAULT_SESSION_GRACE_MS - 1 }, NOW)).toBe(
      "split"
    );
  });

  test("the default grace is ten minutes", () => {
    expect(DEFAULT_SESSION_GRACE_MS).toBe(600_000);
  });
});
