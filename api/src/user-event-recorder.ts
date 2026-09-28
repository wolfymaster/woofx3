import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import type { SharedLogger } from "@woofx3/common/logging";
import type { RecordUserEventRequest } from "@woofx3/db/user_event.pb";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import { type DbClient, DbError } from "./db-client";
import { timestampFromDate } from "./routes/helpers";

/** Who an event is attributed to, and the quantity it carries. */
export interface Attribution {
  /** The viewer's platform id. Absent when the event is attributable to nobody. */
  platformUserId?: string;
  userName?: string;
  /** Bits, gifted subs, raiders, channel points. Absent when the event carries none. */
  amount?: number;
}

type Payload = Record<string, unknown>;

/**
 * The subjects recorded, and how each one names its viewer and quantity.
 *
 * Chat is absent: it is the one high-volume subject and not a fact any total
 * is built from. The shared* events are absent too, because they happened in
 * another channel during a shared chat session and would read as this
 * channel's subs and raids.
 *
 * A community gift arrives as one `SubscriptionGift` for the gifter plus one
 * gifted `Subscribe` per recipient. Both are recorded, as Twitch sent them; a
 * reader counting subs gained must not add the two.
 */
const ATTRIBUTIONS: Readonly<Record<string, (data: Payload) => Attribution>> = {
  [EventType.Cheer]: (data) => ({
    ...(data.isAnonymous === true ? {} : viewer(data.userId, data.userName)),
    amount: quantity(data.amount),
  }),
  [EventType.Follow]: (data) => viewer(data.userId, data.userName),
  [EventType.Raid]: (data) => ({
    ...viewer(data.fromBroadcasterUserId, data.fromBroadcasterUserName),
    amount: quantity(data.viewers),
  }),
  [EventType.Redeem]: (data) => ({
    ...viewer(data.userId, data.userName),
    amount: quantity(data.rewardCost),
  }),
  [EventType.Subscribe]: (data) => viewer(data.userId, data.userName),
  [EventType.SubscriptionGift]: (data) => ({
    ...(data.isAnonymous === true ? {} : viewer(data.gifterId, data.gifterName)),
    amount: quantity(data.amount),
  }),
  [EventType.Resub]: chatter,
  [EventType.GiftPaidUpgrade]: chatter,
  [EventType.PrimePaidUpgrade]: chatter,
  [EventType.PayItForward]: chatter,
};

export const RECORDED_SUBJECTS: readonly string[] = Object.keys(ATTRIBUTIONS);

/**
 * The api republishes dashboard simulations under this source with the real
 * platform stamped, byte-identical to a platform event otherwise. A simulated
 * cheer is not a fact, so nothing it publishes is recorded.
 */
const API_SOURCE = "api";

/**
 * Waits between attempts after a failed write. Retrying is safe only because
 * the write is idempotent on the CloudEvent id: an attempt that succeeded but
 * whose response was lost cannot produce a second row.
 */
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [250, 1_000, 4_000];

interface CloudEventEnvelope {
  id?: unknown;
  source?: unknown;
  type?: unknown;
  time?: unknown;
  platform?: unknown;
  sessionId?: unknown;
  data?: unknown;
}

/**
 * Writes every platform event the engine receives to the `user_events` log,
 * which Analytics aggregates (docs/services/analytics.md).
 *
 * It sits on the bus rather than in each platform integration so there is one
 * writer for every platform, in the process that already holds the db-proxy
 * client, and so a fact is recorded whether or not any workflow reacts to it.
 */
export class UserEventRecorder {
  constructor(
    private nats: NATSClient,
    private db: DbClient,
    private logger: SharedLogger,
    private retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  async start(): Promise<void> {
    for (const subject of RECORDED_SUBJECTS) {
      await this.nats.subscribe(subject, (msg: Msg) => {
        void this.handle(subject, msg);
      });
    }
    this.logger.info("UserEventRecorder started", { subjects: RECORDED_SUBJECTS.length });
  }

  /** Exposed for tests; resolves once the event is recorded or given up on. */
  async handle(subject: string, msg: Msg): Promise<void> {
    let request: RecordUserEventRequest | null;
    try {
      request = toRequest(subject, msg.json() as CloudEventEnvelope);
    } catch (err) {
      this.logger.error("UserEventRecorder: failed to decode CloudEvent", {
        subject,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (request === null) {
      return;
    }
    await this.record(request);
  }

  private async record(request: RecordUserEventRequest): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.recordUserEvent(request);
        return;
      } catch (err) {
        const permanent = err instanceof DbError && err.code === "invalid_argument";
        const delay = this.retryDelaysMs[attempt];
        if (permanent || delay === undefined) {
          this.logger.error("UserEventRecorder: event not recorded", {
            eventType: request.eventType,
            eventId: request.eventId,
            attempts: attempt + 1,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        await this.sleep(delay);
      }
    }
  }
}

/**
 * The write for one bus message, or null when it is not a platform event to
 * record. Exported for tests.
 */
export function toRequest(subject: string, ce: CloudEventEnvelope): RecordUserEventRequest | null {
  const attribute = ATTRIBUTIONS[subject];
  if (attribute === undefined) {
    return null;
  }
  const eventId = text(ce.id);
  const source = text(ce.source);
  const platform = text(ce.platform);
  // An event without an identity cannot be deduplicated, and one without a
  // platform is not a platform event; neither is published by an integration.
  if (eventId === undefined || source === undefined || platform === undefined || source === API_SOURCE) {
    return null;
  }
  const data = isPayload(ce.data) ? ce.data : {};
  const { platformUserId, userName, amount } = attribute(data);
  const sessionId = text(ce.sessionId);

  return {
    eventId,
    source,
    eventType: text(ce.type) ?? subject,
    platform,
    ...(platformUserId !== undefined ? { platformUserId } : {}),
    ...(userName !== undefined ? { userName } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(amount !== undefined ? { amount: BigInt(amount) } : {}),
    eventValue: JSON.stringify(data),
    occurredAt: timestampFromDate(occurredAt(ce.time)),
  };
}

/** The CloudEvent `time`, or now when it is missing or unparseable. */
function occurredAt(time: unknown): Date {
  const parsed = typeof time === "string" ? new Date(time) : undefined;
  if (parsed === undefined || Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function chatter(data: Payload): Attribution {
  if (data.chatterIsAnonymous === true) {
    return {};
  }
  return viewer(data.chatterId, data.chatterName);
}

function viewer(id: unknown, name: unknown): Attribution {
  const platformUserId = text(id);
  if (platformUserId === undefined) {
    return {};
  }
  return { platformUserId, ...(text(name) !== undefined ? { userName: text(name) } : {}) };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function quantity(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isPayload(value: unknown): value is Payload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
