import { BoundedMap } from "../chat/bounded-map";
import { type ViewerKey, viewerKeyString } from "../chat/viewer";
import type { Clock } from "../host/deps";
import type { ChatterHistory } from "./types";

export interface HistoryBounds {
  /** Chatters remembered at once, the least recently heard going first. */
  chatters: number;
  /** Lines remembered per chatter. */
  linesPerChatter: number;
  /** A chatter silent this long is forgotten; at least the longest window a rule may ask about. */
  retainMs: number;
}

interface Said {
  text: string;
  at: number;
}

/** What chatters said recently, in memory, bounded in chatters, lines and time. */
export class MemoryChatterHistory implements ChatterHistory {
  private readonly lines: BoundedMap<string, Said[]>;

  constructor(
    private readonly bounds: HistoryBounds,
    private readonly clock: Clock
  ) {
    this.lines = new BoundedMap({ capacity: bounds.chatters, ttlMs: bounds.retainMs }, clock);
  }

  repeats(viewer: ViewerKey, text: string, windowMs: number): number {
    const key = viewerKeyString(viewer);
    const now = this.clock.now();
    const recent = (this.lines.get(key) ?? []).filter((said) => now - said.at < windowMs);
    recent.push({ text, at: now });
    this.lines.set(key, recent.slice(-this.bounds.linesPerChatter));
    return recent.filter((said) => said.text === text).length;
  }
}
