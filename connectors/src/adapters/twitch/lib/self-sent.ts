import { COMMAND_PREFIX } from "../../../chat/command-prefix";
import type { Clock } from "../../../host/deps";

/** U+200B ZERO WIDTH SPACE, which guardChatLine in ./helix.ts may put in front of a line. */
export const ZERO_WIDTH_SPACE = "\u200b";

export interface SelfSentConfig {
  /** How many lines are remembered at most; the oldest is forgotten first. */
  capacity: number;
  /** How long a line waits for its echo before it is forgotten. */
  ttlMs: number;
}

/** One line the engine is saying, settled once Twitch answers the send. */
export interface SelfSentLine {
  /** Twitch posted the line as `messageId`; from now on only that id claims its echo. */
  sent(messageId: string): void;
  /** Twitch refused or dropped the line, so no echo is coming. */
  failed(): void;
}

/** A line as it came back on the chat feed. */
export interface ChatEcho {
  messageId: string;
  text: string;
  /** Whether the line's chatter is the broadcaster, whose token the engine speaks with. */
  fromBroadcaster: boolean;
}

/** What a claimed echo carries over from its send. */
export interface SelfSentClaim {
  /** The chain of workflow runs that sent the line; undefined when no workflow did. */
  workflowChain: string | undefined;
}

/** What a sender needs of the registry. */
export type SelfSentRecorder = Pick<SelfSentRegistry, "begin">;

interface SelfSentRecord {
  line: string;
  /** Said behind the guard, so it is a command the engine only quotes and the streamer's own typing of it is a different line. */
  guarded: boolean;
  workflowChain: string | undefined;
  /** Null until Twitch answers the send with the posted line's id. */
  messageId: string | null;
  expiresAt: number;
}

/**
 * The form a sent line and its echo are compared in. Twitch trims and
 * collapses whitespace and may or may not keep the guard's zero-width space,
 * so all of those are removed on both sides.
 */
export function normalizeChatLine(text: string): string {
  return text.replaceAll(ZERO_WIDTH_SPACE, "").trim().replace(/\s+/g, " ");
}

/** The handle for a line that cannot echo, such as an empty one. */
const UNRECORDED: SelfSentLine = {
  sent: () => {},
  failed: () => {},
};

/**
 * The chat lines the engine said recently, so their echo on the chat feed is
 * known as the engine's own rather than the streamer typing.
 *
 * The engine speaks with the broadcaster's token, so its lines come back as
 * the broadcaster's. An echo is claimed by the posted line's id when Twitch
 * has answered the send; before then, which happens when the echo outruns
 * the reply, by its text, and only from the broadcaster. Each line answers
 * for one echo only, so the streamer typing the same words afterwards is
 * still read as the streamer.
 *
 * Bounded both ways: a line whose echo never arrives (Twitch gave no answer,
 * or EventSub missed it) expires after `ttlMs`, and at most `capacity` lines
 * are held however fast the engine talks.
 */
export class SelfSentRegistry {
  private readonly records: SelfSentRecord[] = [];

  constructor(
    private readonly config: SelfSentConfig,
    private readonly clock: Clock
  ) {
    if (!Number.isInteger(config.capacity) || config.capacity < 1) {
      throw new Error(`SelfSentRegistry capacity must be a positive integer, got ${config.capacity}`);
    }
    if (!Number.isInteger(config.ttlMs) || config.ttlMs < 1) {
      throw new Error(`SelfSentRegistry ttlMs must be a positive integer, got ${config.ttlMs}`);
    }
  }

  /** Remember a line about to be said, and the workflow chain that is saying it. */
  begin(text: string, workflowChain?: string): SelfSentLine {
    const line = normalizeChatLine(text);
    if (line === "") {
      return UNRECORDED;
    }
    this.prune();
    const record: SelfSentRecord = {
      line,
      guarded: text.startsWith(ZERO_WIDTH_SPACE),
      workflowChain,
      messageId: null,
      expiresAt: this.clock.now() + this.config.ttlMs,
    };
    this.records.push(record);
    if (this.records.length > this.config.capacity) {
      this.records.shift();
    }
    return {
      // A record already claimed by its text, expired or evicted is gone, and
      // settling it is a no-op.
      sent: (messageId) => {
        if (this.records.includes(record)) {
          record.messageId = messageId;
        }
      },
      failed: () => this.forget(record),
    };
  }

  /** The send behind `echo`, forgotten so it claims nothing else, or null for a line the engine did not say. */
  claimEcho(echo: ChatEcho): SelfSentClaim | null {
    this.prune();
    let index = this.records.findIndex((record) => record.messageId === echo.messageId);
    if (index === -1 && echo.fromBroadcaster) {
      const line = normalizeChatLine(echo.text);
      // A guarded line may come back with or without its guard, but the same
      // words typed as a bare command are the streamer running it.
      const bareCommand = echo.text.trimStart().startsWith(COMMAND_PREFIX);
      index = this.records.findIndex(
        (record) => record.messageId === null && record.line === line && !(record.guarded && bareCommand)
      );
    }
    if (index === -1) {
      return null;
    }
    const [record] = this.records.splice(index, 1);
    return { workflowChain: record.workflowChain };
  }

  /** How many lines are waiting for their echo. */
  get size(): number {
    const now = this.clock.now();
    return this.records.filter((record) => record.expiresAt > now).length;
  }

  private forget(record: SelfSentRecord): void {
    const index = this.records.indexOf(record);
    if (index !== -1) {
      this.records.splice(index, 1);
    }
  }

  // Records are held in the order they were begun, all with the same ttl, so
  // the expired ones are always at the front.
  private prune(): void {
    const now = this.clock.now();
    let expired = 0;
    while (expired < this.records.length && this.records[expired].expiresAt <= now) {
      expired++;
    }
    if (expired > 0) {
      this.records.splice(0, expired);
    }
  }
}
