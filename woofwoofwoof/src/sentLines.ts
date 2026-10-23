/** The character a chat line starts with to run a command; see `Commands.parseAction`. */
export const COMMAND_PREFIX = "!";

/**
 * U+200B ZERO WIDTH SPACE. Put in front of an outgoing line that would start
 * with the command prefix, so the line reads the same in chat but its first
 * character is no longer `!`, and the commander never matches it as a command
 * when Twitch hands it back on the chat feed.
 */
const ZERO_WIDTH_SPACE = "​";

/** Twitch's action command: the echoed line carries the text without it. */
const ACTION_PREFIX = /^\/me\s+/i;

export interface SentLineConfig {
  /** How many sent lines are remembered at most; the oldest is forgotten first. */
  capacity: number;
  /** How long a sent line waits for its echo before it is forgotten. */
  ttlMs: number;
}

export const DEFAULT_SENT_LINE_CONFIG: SentLineConfig = {
  capacity: 256,
  ttlMs: 30_000,
};

/** Milliseconds since the epoch. Injected so tests control expiry. */
export type Clock = () => number;

/**
 * `text` made safe to say: a line that would run a command no longer starts
 * with the prefix. Must match guardChatLine in
 * connectors/src/adapters/twitch/lib/helix.ts, which guards lines the bot
 * says through Helix.
 */
export function guardOutgoingLine(text: string): string {
  if (text.startsWith(COMMAND_PREFIX)) {
    return `${ZERO_WIDTH_SPACE}${text}`;
  }
  return text;
}

/**
 * The form a sent line and its echo are compared in. Twitch trims and
 * collapses whitespace, shows a `/me` line without the command, and may or
 * may not keep a zero-width space, so all of those are removed on both sides.
 */
export function normalizeChatLine(text: string): string {
  return text.replaceAll(ZERO_WIDTH_SPACE, "").trim().replace(ACTION_PREFIX, "").replace(/\s+/g, " ");
}

interface SentLine {
  line: string;
  expiresAt: number;
}

/**
 * The lines the bot said recently, so their echo on the chat feed can be told
 * apart from a chatter typing.
 *
 * The bot speaks with the broadcaster's token, so its lines come back as the
 * broadcaster's: filtering on the chatter id alone would also drop the
 * streamer's own commands. A line is the bot's when it comes from the bot's
 * account and matches a line the bot said within `ttlMs`. Each sent line
 * answers for one echo only, so the streamer typing the same words again
 * afterwards is still read.
 *
 * Bounded both ways: a line whose echo never arrives (the send failed after
 * recording, or Twitch dropped it) expires, and at most `capacity` lines are
 * held however fast the bot talks.
 */
export class SentLineRegistry {
  private readonly lines: SentLine[] = [];

  constructor(
    private readonly config: SentLineConfig,
    private readonly now: Clock
  ) {
    if (!Number.isInteger(config.capacity) || config.capacity < 1) {
      throw new Error(`SentLineRegistry capacity must be a positive integer, got ${config.capacity}`);
    }
    if (!Number.isFinite(config.ttlMs) || config.ttlMs <= 0) {
      throw new Error(`SentLineRegistry ttlMs must be a positive number, got ${config.ttlMs}`);
    }
  }

  /** Remember a line the bot is about to say. */
  record(text: string): void {
    const line = normalizeChatLine(text);
    if (line.length === 0) {
      return;
    }
    this.prune();
    this.lines.push({ line, expiresAt: this.now() + this.config.ttlMs });
    if (this.lines.length > this.config.capacity) {
      this.lines.shift();
    }
  }

  /** True, and forgets the line, when `text` matches a line the bot said that has not expired. */
  consume(text: string): boolean {
    this.prune();
    const line = normalizeChatLine(text);
    const index = this.lines.findIndex((sent) => sent.line === line);
    if (index === -1) {
      return false;
    }
    this.lines.splice(index, 1);
    return true;
  }

  // Lines are held in the order they were said, all with the same ttl, so the
  // expired ones are always at the front.
  private prune(): void {
    const now = this.now();
    let expired = 0;
    while (expired < this.lines.length && this.lines[expired].expiresAt <= now) {
      expired++;
    }
    if (expired > 0) {
      this.lines.splice(0, expired);
    }
  }
}
