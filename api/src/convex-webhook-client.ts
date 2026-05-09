import { createHmac, randomUUID } from "node:crypto";
import type { SharedLogger } from "@woofx3/common/logging";
import type {
  AlertContext,
  WebhookEnvelope,
  WebhookKind,
  WebhookPayload,
} from "@woofx3/common/cloudevents/Alert/events";
import type { OBSCommand } from "@woofx3/common/cloudevents/Obs/commands";
import type { DbClient } from "./db-client";

const SETTING_KEY_URL = "convex.webhook_url";
const SETTING_KEY_SECRET = "convex.signing_secret";

// Retry schedule per browser-source-spec.md: 1s, 5s, 30s, 5m, 30m, then drop.
// Items are also dropped once `ttlMs` has elapsed since first attempt.
const RETRY_SCHEDULE_MS = [1_000, 5_000, 30_000, 5 * 60_000, 30 * 60_000];
const DEFAULT_TTL_MS = 60 * 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const DEDUP_CAP = 10_000;

export interface ConvexWebhookClientDeps {
  db: DbClient;
  logger: SharedLogger;
  applicationId: string;
  fetchFn?: typeof fetch;
  scheduleRetry?: (fn: () => void, ms: number) => void;
  ttlMs?: number;
}

interface InFlight {
  envelope: WebhookEnvelope;
  rawBody: string;
  attempt: number;
  expiresAt: number;
}

export class ConvexWebhookClient {
  private db: DbClient;
  private logger: SharedLogger;
  private applicationId: string;
  private fetchFn: typeof fetch;
  private scheduleRetry: (fn: () => void, ms: number) => void;
  private ttlMs: number;

  private webhookUrl: string | null = null;
  private signingSecret: string | null = null;
  private configLoaded = false;
  private warnedMissingConfig = false;

  private dedup: Set<string> = new Set();
  private dedupOrder: string[] = [];
  private inFlight: Set<string> = new Set();

  constructor(deps: ConvexWebhookClientDeps) {
    this.db = deps.db;
    this.logger = deps.logger;
    this.applicationId = deps.applicationId;
    this.fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.scheduleRetry =
      deps.scheduleRetry ??
      ((fn, ms) => {
        setTimeout(fn, ms);
      });
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  }

  setApplicationId(applicationId: string): void {
    this.applicationId = applicationId;
    this.configLoaded = false;
    this.webhookUrl = null;
    this.signingSecret = null;
    this.warnedMissingConfig = false;
  }

  async loadConfig(): Promise<void> {
    try {
      const [url, secret] = await Promise.all([
        this.db.getSetting(SETTING_KEY_URL, this.applicationId),
        this.db.getSetting(SETTING_KEY_SECRET, this.applicationId),
      ]);
      this.webhookUrl = url ?? null;
      this.signingSecret = secret ?? null;
      this.configLoaded = true;
      if (!this.webhookUrl || !this.signingSecret) {
        if (!this.warnedMissingConfig) {
          this.logger.warn("Convex webhook config missing; alerts will be dropped", {
            hasUrl: !!this.webhookUrl,
            hasSecret: !!this.signingSecret,
          });
          this.warnedMissingConfig = true;
        }
        return;
      }
      this.logger.info("Convex webhook config loaded", { url: this.webhookUrl });
    } catch (err) {
      this.logger.error("Failed to load Convex webhook config", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async sendAlert(channelId: string, ctx: AlertContext): Promise<void> {
    return this.send(channelId, "alert", ctx);
  }

  async sendObsCommand(channelId: string, cmd: OBSCommand): Promise<void> {
    return this.send(channelId, "obs_command", cmd);
  }

  // Send a pre-built envelope. Used by callers that want explicit control over
  // the eventId (e.g. replays). Honors the in-memory dedup set.
  async sendEnvelope(envelope: WebhookEnvelope): Promise<void> {
    if (!this.configLoaded) {
      await this.loadConfig();
    }
    if (!this.webhookUrl || !this.signingSecret) {
      return;
    }
    if (this.dedup.has(envelope.eventId)) {
      this.logger.debug("Convex webhook: dropping duplicate eventId", {
        eventId: envelope.eventId,
      });
      return;
    }
    this.markDeduped(envelope.eventId);
    const item: InFlight = {
      envelope,
      rawBody: JSON.stringify(envelope),
      attempt: 0,
      expiresAt: Date.now() + this.ttlMs,
    };
    this.inFlight.add(envelope.eventId);
    await this.deliver(item);
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }

  private async send(channelId: string, kind: WebhookKind, payload: WebhookPayload): Promise<void> {
    if (!this.configLoaded) {
      await this.loadConfig();
    }
    if (!this.webhookUrl || !this.signingSecret) {
      return;
    }

    const envelope: WebhookEnvelope = {
      eventId: randomUUID(),
      channelId,
      emittedAt: Date.now(),
      kind,
      payload,
    };

    this.markDeduped(envelope.eventId);
    const item: InFlight = {
      envelope,
      rawBody: JSON.stringify(envelope),
      attempt: 0,
      expiresAt: Date.now() + this.ttlMs,
    };
    this.inFlight.add(envelope.eventId);
    await this.deliver(item);
  }

  private async deliver(item: InFlight): Promise<void> {
    if (Date.now() > item.expiresAt) {
      this.logger.warn("Convex webhook expired before delivery", {
        eventId: item.envelope.eventId,
        attempt: item.attempt,
      });
      this.inFlight.delete(item.envelope.eventId);
      return;
    }

    const signature = this.sign(item.rawBody);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await this.fetchFn(this.webhookUrl as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Woofx3-Signature": `sha256=${signature}`,
        },
        body: item.rawBody,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        this.logger.info("Convex webhook delivered", {
          eventId: item.envelope.eventId,
          attempt: item.attempt,
          status: response.status,
        });
        this.inFlight.delete(item.envelope.eventId);
        return;
      }

      if (response.status >= 400 && response.status < 500) {
        this.logger.warn("Convex webhook rejected (terminal 4xx)", {
          eventId: item.envelope.eventId,
          status: response.status,
        });
        this.inFlight.delete(item.envelope.eventId);
        return;
      }

      this.scheduleNext(item, `HTTP ${response.status}`);
    } catch (err) {
      clearTimeout(timeoutId);
      const message = err instanceof Error ? err.message : String(err);
      this.scheduleNext(item, message);
    }
  }

  private scheduleNext(item: InFlight, reason: string): void {
    if (item.attempt >= RETRY_SCHEDULE_MS.length) {
      this.logger.error("Convex webhook giving up after all retries", {
        eventId: item.envelope.eventId,
        attempts: item.attempt,
        reason,
      });
      this.inFlight.delete(item.envelope.eventId);
      return;
    }

    const delayMs = RETRY_SCHEDULE_MS[item.attempt];
    this.logger.warn("Convex webhook delivery failed, retrying", {
      eventId: item.envelope.eventId,
      nextAttempt: item.attempt + 1,
      delayMs,
      reason,
    });

    item.attempt += 1;
    this.scheduleRetry(() => {
      void this.deliver(item);
    }, delayMs);
  }

  private sign(body: string): string {
    return createHmac("sha256", this.signingSecret as string).update(body).digest("hex");
  }

  private markDeduped(eventId: string): void {
    if (this.dedup.has(eventId)) {
      return;
    }
    this.dedup.add(eventId);
    this.dedupOrder.push(eventId);
    while (this.dedupOrder.length > DEDUP_CAP) {
      const evicted = this.dedupOrder.shift();
      if (evicted !== undefined) {
        this.dedup.delete(evicted);
      }
    }
  }
}
