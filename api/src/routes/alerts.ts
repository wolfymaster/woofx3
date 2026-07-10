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

export const alertsRoutes = {
  async replayAlert(id: string): Promise<boolean> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    if (!id) {
      throw new Error("alert id is required");
    }
    this.logger.info("Replaying alert (forwarding to streamware)", { id });
    const reply = await this.nats.request("widget.queue.replay", new TextEncoder().encode(JSON.stringify({ id })));
    const result = JSON.parse(new TextDecoder().decode(reply.data)) as {
      ok: boolean;
      message: string;
      replayEnvelopeId?: string;
    };
    if (!result.ok) {
      this.logger.warn("Replay rejected", { id, reason: result.message });
      return false;
    }
    this.logger.info("Alert replayed", { id, replayEnvelopeId: result.replayEnvelopeId });
    return true;
  },

  /**
   * Forward a "skip the current alert" RPC to streamware's queue
   * manager. The orchestrator marks the in-flight alert `skipped`,
   * dispatches the next pending, and the standard
   * `db.alert.updated.*` outbox event drives the ALERT_SKIPPED
   * webhook from the api boundary.
   */
  async skipCurrentAlert(applicationId?: string): Promise<{ skipped: boolean }> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    const appId = applicationId || (await this.ensureApplicationId());
    const reply = await this.nats.request(
      "widget.queue.skip",
      new TextEncoder().encode(JSON.stringify({ applicationId: appId }))
    );
    const result = JSON.parse(new TextDecoder().decode(reply.data)) as { skipped: boolean };
    this.logger.info("skipCurrentAlert", { applicationId: appId, skipped: result.skipped });
    return result;
  },

  /**
   * Forward a "clear pending" RPC to streamware. The orchestrator
   * marks every pending alert `skipped` (without touching the
   * in-flight lease) and returns the count.
   */
  async clearAlertQueue(applicationId?: string): Promise<{ cleared: number }> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    const appId = applicationId || (await this.ensureApplicationId());
    const reply = await this.nats.request(
      "widget.queue.clear",
      new TextEncoder().encode(JSON.stringify({ applicationId: appId }))
    );
    const result = JSON.parse(new TextDecoder().decode(reply.data)) as { cleared: number };
    this.logger.info("clearAlertQueue", { applicationId: appId, cleared: result.cleared });
    return result;
  }
};
