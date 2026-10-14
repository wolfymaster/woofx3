import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import type { SharedLogger } from "@woofx3/common/logging";
import type { RecordUserEventRequest } from "@woofx3/db/user_event.pb";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import { type DbClient, DbError } from "./db-client";
import { type EventCatalog, type LoggedEvent, SubjectSubscriptions, type ViewerIdentity } from "./event-catalog";
import type { EventLogSelectionSource } from "./event-log-selection";
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
 * How the Twitch events Analytics totals name their viewer and quantity. Every
 * other logged event is attributed from its trigger's `emits` identity
 * annotations and carries no quantity: `amount` is what the totals add up, so
 * it is set only where a total knows what it means.
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

/**
 * The Twitch event types attributed above: the viewer activity Analytics
 * totals and the dashboard's recent figures count. They are recorded whatever
 * the streamer's selection, so a recap never depends on it. The log holds
 * other selected events too, and a wheel landing or a counter changing is not
 * that activity. The recorder stores a Twitch event under the subject it
 * subscribed to, which is the CloudEvent type.
 */
export const ANALYTICS_EVENT_TYPES: readonly string[] = Object.keys(ATTRIBUTIONS);

/**
 * The api republishes dashboard simulations under this source with the real
 * platform stamped, byte-identical to a platform event otherwise. A simulated
 * cheer is not a fact, so nothing it publishes is recorded.
 */
const API_SOURCE = "api";

/**
 * Column widths of `user_events`. Must match userEventUserIDMaxLen and
 * userEventUserNameMaxLen in db/app/services/user_event_service.go.
 */
const USER_ID_MAX_LENGTH = 100;
const USER_NAME_MAX_LENGTH = 100;

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
 * Writes the event types the streamer selected (`EventLogSelectionSource`)
 * and the `ANALYTICS_EVENT_TYPES` to the `user_events` log: the history the
 * dashboard's event feed reads, and what Analytics aggregates
 * (docs/services/analytics.md).
 *
 * It sits on the bus rather than in each platform integration so there is one
 * writer for every platform and module, in the process that already holds the
 * db-proxy client, and so an event is recorded whether or not any workflow
 * reacts to it.
 */
export class UserEventRecorder {
  private subscriptions: SubjectSubscriptions;
  private recorded: ReadonlySet<string> = new Set();

  constructor(
    nats: NATSClient,
    private db: Pick<DbClient, "recordUserEvent">,
    private logger: SharedLogger,
    private catalog: EventCatalog,
    private selection: EventLogSelectionSource,
    private retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  ) {
    this.subscriptions = new SubjectSubscriptions(
      nats,
      (subject, msg) => {
        void this.handle(subject, msg);
      },
      logger,
      "UserEventRecorder"
    );
  }

  /**
   * Records the enabled types and the analytics types from now on, following
   * the selection and the installed triggers as they change.
   */
  async start(): Promise<void> {
    this.selection.onChange((settings) => this.follow(settings.enabled));
    await this.follow(this.selection.settings.enabled);
    this.logger.info("UserEventRecorder started", { subjects: this.recorded.size });
  }

  private follow(enabled: readonly string[]): Promise<void> {
    this.recorded = new Set([...enabled, ...ANALYTICS_EVENT_TYPES]);
    return this.subscriptions.sync(this.recorded);
  }

  /** Exposed for tests; resolves once the event is recorded or given up on. */
  async handle(subject: string, msg: Msg): Promise<void> {
    if (!this.recorded.has(subject)) {
      // Delivered just after its type was turned off or its triggers removed.
      return;
    }
    // An analytics type is recorded even with no installed trigger for it;
    // its attribution is the fixed map's, and its platform is stamped.
    const logged = this.catalog.events.get(subject) ?? { subject, moduleId: "", onByDefault: false };
    let request: RecordUserEventRequest | null;
    try {
      request = toRequest(logged, msg.json() as CloudEventEnvelope);
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
 * The write for one bus message, or null when it is not an event to record.
 * Exported for tests.
 *
 * `platform` is the CloudEvent's `platform` extension, which every platform
 * integration stamps. A module's own events (a goal reached, a Ko-fi tip
 * relayed by its webhook handler) often carry none, and the log requires one,
 * so they are recorded under the id of the module that registered the
 * trigger: the event is the module's, and the module id is what the UI groups
 * events by.
 */
export function toRequest(logged: LoggedEvent, ce: CloudEventEnvelope): RecordUserEventRequest | null {
  const subject = logged.subject;
  const eventId = text(ce.id);
  const source = text(ce.source);
  const platform = text(ce.platform) ?? text(logged.moduleId);
  // An event without an identity cannot be deduplicated.
  if (eventId === undefined || source === undefined || platform === undefined || source === API_SOURCE) {
    return null;
  }
  const data = isPayload(ce.data) ? ce.data : {};
  const attribute = ATTRIBUTIONS[subject];
  const { platformUserId, userName, amount } =
    attribute !== undefined ? attribute(data) : identityAttribution(logged.identity, data);
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

/**
 * The viewer an event's trigger declares in its `emits`, read from the event's
 * data. An id or name too long for the log is dropped rather than failing the
 * write, so a module's oversized value costs the attribution, not the event.
 */
function identityAttribution(identity: ViewerIdentity | undefined, data: Payload): Attribution {
  if (identity === undefined) {
    return {};
  }
  if (identity.anonymousWhen !== undefined && valueAt(data, identity.anonymousWhen) === true) {
    return {};
  }
  const platformUserId = text(valueAt(data, identity.path));
  if (platformUserId === undefined || platformUserId.length > USER_ID_MAX_LENGTH) {
    return {};
  }
  const userName = identity.displayName !== undefined ? text(valueAt(data, identity.displayName)) : undefined;
  return {
    platformUserId,
    ...(userName !== undefined && userName.length <= USER_NAME_MAX_LENGTH ? { userName } : {}),
  };
}

/** The value at a dot path of `emits`, e.g. `user.id`. */
function valueAt(data: Payload, path: string): unknown {
  let value: unknown = data;
  for (const key of path.split(".")) {
    if (!isPayload(value)) {
      return undefined;
    }
    value = value[key];
  }
  return value;
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
