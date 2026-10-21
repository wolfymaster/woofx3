export interface SelfSentConfig {
  /** How many sent lines are remembered at most; the oldest is forgotten first. */
  capacity: number;
  /** How long a sent line waits for its echo before it is forgotten. */
  ttlMs: number;
}

export const DEFAULT_SELF_SENT_CONFIG: SelfSentConfig = {
  capacity: 256,
  ttlMs: 30_000,
};

/** Milliseconds since the epoch. Injected so tests control expiry. */
export type Clock = () => number;

/** U+200B ZERO WIDTH SPACE, which guardChatLine (./helix.ts) puts in front of a line. */
const ZERO_WIDTH_SPACE = "​";

/**
 * The form a sent line and its echo are compared in. Twitch trims and
 * collapses whitespace and may or may not keep the zero-width space a guarded
 * line starts with, so all of those are removed on both sides.
 */
export function normalizeChatLine(text: string): string {
  return text.replaceAll(ZERO_WIDTH_SPACE, "").trim().replace(/\s+/g, " ");
}

/** What becomes of one line once Twitch has answered the request that sent it. */
export interface PendingChatLine {
  /** Twitch said it with this id; its echo is matched by the id from now on. */
  sent(messageId: string): void;
  /** Twitch did not say it (refused or dropped it), so no echo will come. */
  failed(): void;
}

/** Where every chat line the engine sends through Helix is recorded. */
export interface ChatLineLog {
  /** Record `text`, exactly as it goes to Twitch, just before it is sent. */
  begin(text: string): PendingChatLine;
}

/** A `channel.chat.message` as far as telling the engine's own lines apart needs. */
export interface ChatEcho {
  messageId: string;
  chatterId: string;
  text: string;
}

interface SentLine {
  line: string;
  /** Unset while the request is in flight, or for a send Twitch gives no id for (an announcement). */
  messageId?: string;
  expiresAt: number;
}

/**
 * The chat lines the engine sent recently, so their echo on the chat feed is
 * marked `fromEngine` and no consumer answers the engine's own words.
 *
 * Every line goes out with the broadcaster's token and comes back as the
 * broadcaster's, so the chatter alone cannot tell them apart from the
 * streamer typing. Once Twitch has answered with the line's id, the echo is
 * matched by id. Twitch often delivers the echo before that answer, so until
 * then a line from the broadcaster's account with the same text matches. Each
 * sent line claims one echo, so the streamer typing the same words afterwards
 * is still read as the streamer.
 *
 * Bounded both ways: a line whose echo never arrives expires after `ttlMs`,
 * and at most `capacity` lines are held however fast the engine talks.
 */
export class SelfSentRegistry implements ChatLineLog {
  private readonly lines: SentLine[] = [];

  constructor(
    private readonly config: SelfSentConfig,
    private readonly now: Clock
  ) {
    if (!Number.isInteger(config.capacity) || config.capacity < 1) {
      throw new Error(`SelfSentRegistry capacity must be a positive integer, got ${config.capacity}`);
    }
    if (!Number.isFinite(config.ttlMs) || config.ttlMs <= 0) {
      throw new Error(`SelfSentRegistry ttlMs must be a positive number, got ${config.ttlMs}`);
    }
  }

  begin(text: string): PendingChatLine {
    this.prune();
    const record: SentLine = { line: normalizeChatLine(text), expiresAt: this.now() + this.config.ttlMs };
    this.lines.push(record);
    if (this.lines.length > this.config.capacity) {
      this.lines.shift();
    }
    // A record already gone (claimed by an early echo, expired or evicted)
    // is left gone: each answers for one echo only.
    return {
      sent: (messageId: string) => {
        if (messageId === "") {
          throw new Error("SelfSentRegistry: a sent line needs Twitch's message id");
        }
        if (this.lines.includes(record)) {
          record.messageId = messageId;
        }
      },
      failed: () => {
        this.remove(record);
      },
    };
  }

  /**
   * True, and forgets the line, when `echo` is Twitch handing back a line the
   * engine sent: its id is a recorded one, or it comes from `broadcasterId`
   * with the text of a line still waiting for Twitch's answer.
   */
  claimEcho(echo: ChatEcho, broadcasterId: string): boolean {
    this.prune();
    const byId = this.lines.find((sent) => sent.messageId !== undefined && sent.messageId === echo.messageId);
    if (byId) {
      this.remove(byId);
      return true;
    }
    if (echo.chatterId !== broadcasterId) {
      return false;
    }
    const line = normalizeChatLine(echo.text);
    const byText = this.lines.find((sent) => sent.messageId === undefined && sent.line === line);
    if (byText) {
      this.remove(byText);
      return true;
    }
    return false;
  }

  private remove(record: SentLine): void {
    const index = this.lines.indexOf(record);
    if (index !== -1) {
      this.lines.splice(index, 1);
    }
  }

  // Lines are held in the order they were sent, all with the same ttl, so the
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
