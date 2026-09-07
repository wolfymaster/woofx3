import { getStreamStatus, type StreamStatus } from "../twitch-stream-status";
import { routeModule } from "./context";
import { EngineEventType } from "@woofx3/api/webhooks";
import { parseModuleTriggerDeregistered, parseModuleTriggerRegistered } from "../module-event-handlers";

/**
 * Subscriptions that stay on `Api`/`ApiRouteHost` rather than living in
 * a self-contained `*-event-handlers.ts` module (see
 * `module-event-handlers.ts`, `workflow-event-handlers.ts`,
 * `scene-event-handlers.ts`, `alert-log-handlers.ts`,
 * `widget-status-handlers.ts`, all initialised directly from
 * `application.ts`): these four need more than
 * `(nats, webhookClient, logger)` —
 *
 *   - `db.module.trigger.{registered,deregistered}.*` also has to
 *     notify in-process trigger subscribers via
 *     `this.notifyTriggerChange`, which reaches into
 *     `ApiRouteHost.triggerSubscribers`.
 *   - `{online,offline}.channel.twitch` call `this.getStreamStatus`
 *     (a real RPC method, for enrichment) and
 *     `this.ensureApplicationId`/`this.applicationId` (the cached
 *     default-application id). Extracting them to a standalone
 *     function would just mean passing the same `Api` instance in
 *     under a different name — no real decoupling, more indirection.
 */
export const subscriptionsRoutes = routeModule({
  async initSubscriptions(): Promise<void> {
    if (!this.nats) {
      this.logger.warn("NATS client not available, skipping subscriptions");
      return;
    }

    this.logger.info("Initializing NATS subscriptions for module events");

    await this.nats.subscribe("db.module.trigger.registered.*", async (msg) => {
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleTriggerRegistered(ce);
        await this.notifyTriggerChange(event.moduleKey);
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.trigger.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.trigger.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.trigger.deregistered.*", async (msg) => {
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleTriggerDeregistered(ce);
        await this.notifyTriggerChange(event.modulePrefix);
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.trigger.deregistered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.trigger.deregistered NATS event", { err });
      }
    });

    // Twitch stream lifecycle. The twitch service publishes
    // `online.channel.twitch` / `offline.channel.twitch` cloudevents from
    // its EventSub listener; we translate them to the webhook
    // `stream.online` / `stream.offline` events the UI subscribes to.
    //
    // applicationId is resolved lazily from the default application —
    // the engine is single-broadcaster-per-deployment today, so every
    // emitted event scopes to the same id.
    await this.nats.subscribe("online.channel.twitch", async (msg) => {
      try {
        const ce = msg.json() as Record<string, unknown>;
        const data = (ce.data as Record<string, unknown> | undefined) ?? ce;
        const twitchUserId =
          typeof data.broadcasterUserId === "string"
            ? (data.broadcasterUserId as string)
            : typeof data.broadcaster_user_id === "string"
              ? (data.broadcaster_user_id as string)
              : "";
        const startedAt =
          typeof data.startedAt === "string"
            ? (data.startedAt as string)
            : typeof data.started_at === "string"
              ? (data.started_at as string)
              : new Date().toISOString();
        if (!this.webhookClient) {
          return;
        }
        // Best-effort enrichment via the live-state RPC path so the UI
        // can render title / game / viewer count on the same event.
        // Failures degrade silently — the minimal payload is still
        // useful (the UI polls every minute as backup).
        let enrichment: StreamStatus | null = null;
        try {
          enrichment = await getStreamStatus(this.db, this.logger);
        } catch (err) {
          this.logger.warn("stream.online enrichment failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        let applicationId = this.applicationId;
        if (!applicationId) {
          try {
            applicationId = await this.ensureApplicationId();
          } catch {
            this.logger.warn("stream.online: no applicationId yet; skipping webhook");
            return;
          }
        }
        await this.webhookClient.send({
          type: EngineEventType.STREAM_ONLINE,
          applicationId,
          twitchUserId,
          startedAt: enrichment?.startedAt ?? startedAt,
          streamTitle: enrichment?.streamTitle,
          gameName: enrichment?.gameName,
          viewerCount: enrichment?.viewerCount,
        });
      } catch (err) {
        this.logger.error("online.channel.twitch: handler failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await this.nats.subscribe("offline.channel.twitch", async (msg) => {
      try {
        const ce = msg.json() as Record<string, unknown>;
        const data = (ce.data as Record<string, unknown> | undefined) ?? ce;
        const twitchUserId =
          typeof data.broadcasterUserId === "string"
            ? (data.broadcasterUserId as string)
            : typeof data.broadcaster_user_id === "string"
              ? (data.broadcaster_user_id as string)
              : "";
        if (!this.webhookClient) {
          return;
        }
        let applicationId = this.applicationId;
        if (!applicationId) {
          try {
            applicationId = await this.ensureApplicationId();
          } catch {
            this.logger.warn("stream.offline: no applicationId yet; skipping webhook");
            return;
          }
        }
        await this.webhookClient.send({
          type: EngineEventType.STREAM_OFFLINE,
          applicationId,
          twitchUserId,
        });
      } catch (err) {
        this.logger.error("offline.channel.twitch: handler failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    this.logger.info("NATS subscriptions initialized for module events");
  }
});
