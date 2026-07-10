import type {
  AvailableFunction,
  CommandSnapshot,
  CommandType,
  CreateCommandInput,
  CreateWorkflowInput,
  FieldOptionsDescriptor,
  PingResponse,
  Scene,
  StorageConfig,
  UpdateCommandInput,
  UpdateWorkflowInput,
  WorkflowDefinition,
  WorkflowMutationResult,
} from "@woofx3/api";
import type {
  ActionDefinition,
  SceneCreatedEvent,
  SceneDeletedEvent,
  SceneUpdatedEvent,
  TriggerDefinition,
  WorkflowCreatedEvent,
  WorkflowDeletedEvent,
  WorkflowUpdatedEvent,
} from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { Action } from "@woofx3/db/module_action.pb";
import type { Trigger } from "@woofx3/db/module_trigger.pb";
import type * as command from "@woofx3/db/command.pb";
import type * as scene from "@woofx3/db/scene.pb";
import type * as treat from "@woofx3/db/treat.pb";
import type * as user from "@woofx3/db/user.pb";
import type * as workflow from "@woofx3/db/workflow.pb";
import * as protoscript from "protoscript";
import { ApiRouteHost } from "./context";
import {
  commandToSnapshot,
  dbSceneToSnapshot,
  dbSceneToWire,
  readModuleCatalogFields,
  rebuildWorkflowDefinition,
  timestampFromDate,
  timestampToIso,
} from "./helpers";
import type { UninstallModuleResponse, WorkflowItem } from "./types";
import {
  parseModuleActionDeregistered,
  parseModuleActionRegistered,
  parseModuleAssetDeregistered,
  parseModuleAssetRegistered,
  parseModuleFunctionDeregistered,
  parseModuleFunctionRegistered,
  parseModuleResourceInstanceCreated,
  parseModuleResourceInstanceDeleted,
  parseModuleTriggerDeregistered,
  parseModuleTriggerRegistered,
  parseModuleWidgetDeregistered,
  parseModuleWidgetRegistered,
} from "../module-event-handlers";
import { parseWorkflowCreated, parseWorkflowDeleted, parseWorkflowUpdated } from "../workflow-event-handlers";
import { parseSceneCreated, parseSceneDeleted, parseSceneUpdated } from "../scene-event-handlers";
import { parseAlertCreated, parseAlertUpdated } from "../alert-log-handlers";
import { validateWorkflowDefinition } from "../workflow/validate-definition";

export const fieldOptionsRoutes = {
  async dispatchFieldOptionsRequest(
    descriptor: FieldOptionsDescriptor,
    correlationKey: string
  ): Promise<{ dispatched: boolean }> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    if (descriptor.kind !== "internal") {
      throw new Error(`Unsupported descriptor kind: ${descriptor.kind}`);
    }

    const eventId = crypto.randomUUID();
    const requestEnvelope = {
      id: eventId,
      type: descriptor.request.event,
      source: "api",
      time: new Date().toISOString(),
      data: descriptor.request.payload ?? {},
    };
    const requestBytes = new TextEncoder().encode(JSON.stringify(requestEnvelope));
    const timeout = descriptor.timeoutMs ?? 10_000;
    const nats = this.nats;

    this.logger.info("dispatchFieldOptionsRequest dispatching", {
      correlationKey,
      subject: descriptor.request.event,
      payload: descriptor.request.payload,
      timeoutMs: timeout,
    });

    // `no responders` is NATS's immediate "zero subscribers on this
    // subject right now" reply — common in dev when a worker is still
    // booting (Twurple + EventSub setup, etc.) at the moment the user
    // opens a dropdown. Retry on `no responders` only — other errors
    // (timeout from a slow handler, malformed reply, etc.) propagate
    // immediately so we don't paper over real bugs.
    const requestWithBootRetry = async (): Promise<{ data: Uint8Array }> => {
      const backoffsMs = [250, 500, 1000, 2000];
      let lastError: unknown;
      for (let attempt = 0; attempt <= backoffsMs.length; attempt++) {
        try {
          return await nats.request(descriptor.request.event, requestBytes, { timeout });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("no responders")) {
            throw err;
          }
          lastError = err;
          if (attempt === backoffsMs.length) {
            break;
          }
          const delay = backoffsMs[attempt];
          this.logger.info("dispatchFieldOptionsRequest no responders, retrying", {
            correlationKey,
            subject: descriptor.request.event,
            attempt: attempt + 1,
            nextDelayMs: delay,
          });
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };

    // Fire-and-forget: kick off the request, route the reply (or error)
    // through the webhook back to Convex without holding this RPC open.
    requestWithBootRetry()
      .then(async (reply) => {
        const text = new TextDecoder().decode(reply.data);
        let data: unknown;
        try {
          const parsed = JSON.parse(text);
          // Workers may reply with a CloudEvent envelope ({type, data, ...})
          // or raw data. Prefer envelope.data when present.
          data = parsed && typeof parsed === "object" && "data" in parsed ? (parsed as { data: unknown }).data : parsed;
        } catch {
          data = text;
        }

        // Result-shape summary mirrors the twitch worker side so the
        // request and response sides line up in the logs. An empty array
        // here usually means the worker ran fine and just returned []
        // (e.g. broadcaster has no manageable rewards) — distinct from
        // the .catch path which means the request never got a reply.
        let dataSummary: string;
        if (Array.isArray(data)) {
          dataSummary = `array(len=${data.length})${
            data.length > 0 ? ` first=${JSON.stringify(data[0]).slice(0, 200)}` : ""
          }`;
        } else if (data === null || data === undefined) {
          dataSummary = String(data);
        } else if (typeof data === "object") {
          dataSummary = `object keys=[${Object.keys(data as Record<string, unknown>).join(", ")}]`;
        } else {
          dataSummary = `${typeof data} ${JSON.stringify(data).slice(0, 200)}`;
        }
        this.logger.info("dispatchFieldOptionsRequest reply received", {
          correlationKey,
          subject: descriptor.request.event,
          dataSummary,
          willForward: !!this.webhookClient,
        });

        if (this.webhookClient) {
          await this.webhookClient.send({
            type: EngineEventType.ENGINE_RESPONSE_RECEIVED,
            correlationKey,
            status: "success",
            data,
          });
        }
      })
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn("dispatchFieldOptionsRequest reply failed", {
          correlationKey,
          subject: descriptor.request.event,
          error: message,
        });
        if (this.webhookClient) {
          await this.webhookClient.send({
            type: EngineEventType.ENGINE_RESPONSE_RECEIVED,
            correlationKey,
            status: "error",
            error: message,
          });
        }
      });

    return { dispatched: true };
  }
};
