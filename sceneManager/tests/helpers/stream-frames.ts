import type { StreamFrame } from "../../contract/overlay-stream";

/** A stream frame as the SSE event name and payload a page receives. */
export function eventAndData(frame: StreamFrame): { event: string; data: unknown } {
  switch (frame.kind) {
    case "hello":
      return { event: "hello", data: { bootId: frame.bootId, seq: frame.seq, draftSeq: frame.draftSeq } };
    case "scene-ops":
      return { event: "scene-ops", data: frame.event };
    default:
      return { event: frame.kind, data: frame.frame };
  }
}
