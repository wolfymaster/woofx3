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

export const subscriptionsRoutes = {
  async initSubscriptions(): Promise<void> {
    if (!this.nats) {
      this.logger.warn("NATS client not available, skipping subscriptions");
      return;
    }

    this.logger.info("Initializing NATS subscriptions for module events");

    // R1: orchestration relocated to streamware. The api keeps only
    // db-outbox → webhook projection (its boundary role). Streamware
    // now subscribes to `ui.notify.alert`, `ui.widget.status`, and
    // `module.widget.status.changed`; see streamware/src/widget-event-
    // handlers.ts. The api subscribes below to the resulting outbox
    // events (`db.alert.{created,updated}.*`,
    // `db.widget_status.updated.*`) and projects them to webhooks.
    //
    // applicationId resolution that used to live here also moved to
    // the orchestrator. The api still tracks `this.applicationId` for
    // its own RPC paths (e.g. resolving default app on operator
    // controls) but doesn't need to consult it here.

    await this.nats.subscribe("db.module.trigger.registered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.trigger.registered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleTriggerRegistered(ce);
        this.logger.info("Parsed module.trigger.registered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          triggerCount: event.triggers.length,
          clientId,
        });

        await this.notifyTriggerChange(event.moduleKey);

        if (this.webhookClient) {
          this.logger.info("Sending module.trigger.registered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.trigger.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.trigger.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.action.registered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.action.registered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleActionRegistered(ce);
        this.logger.info("Parsed module.action.registered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          actionCount: event.actions.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.action.registered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.action.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.action.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.function.registered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.function.registered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleFunctionRegistered(ce);
        this.logger.info("Parsed module.function.registered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          functionCount: event.functions.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.function.registered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.function.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.function.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.trigger.deregistered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.trigger.deregistered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleTriggerDeregistered(ce);
        this.logger.info("Parsed module.trigger.deregistered", {
          modulePrefix: event.modulePrefix,
          triggerCount: event.triggers.length,
          clientId,
        });

        await this.notifyTriggerChange(event.modulePrefix);

        if (this.webhookClient) {
          this.logger.info("Sending module.trigger.deregistered to webhook client", {
            modulePrefix: event.modulePrefix,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.trigger.deregistered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.trigger.deregistered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.action.deregistered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.action.deregistered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleActionDeregistered(ce);
        this.logger.info("Parsed module.action.deregistered", {
          modulePrefix: event.modulePrefix,
          actionCount: event.actions.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.action.deregistered to webhook client", {
            modulePrefix: event.modulePrefix,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.action.deregistered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.action.deregistered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.function.deregistered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.function.deregistered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleFunctionDeregistered(ce);
        this.logger.info("Parsed module.function.deregistered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          functionCount: event.functions.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.function.deregistered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.function.deregistered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.function.deregistered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.widget.registered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.widget.registered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleWidgetRegistered(ce);
        this.logger.info("Parsed module.widget.registered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          widgetCount: event.widgets.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.widget.registered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.widget.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.widget.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.widget.deregistered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.widget.deregistered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleWidgetDeregistered(ce);
        this.logger.info("Parsed module.widget.deregistered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          widgetCount: event.widgets.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.widget.deregistered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.widget.deregistered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.widget.deregistered NATS event", { err });
      }
    });

    // Module asset registration / deregistration outbox. Mirror of the
    // widget rails: db proxy publishes after RegisterAssets /
    // DeleteAssetsByModuleId; api forwards to the registered callback
    // so the editor can refresh its asset picker.
    await this.nats.subscribe("db.module.asset.registered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.asset.registered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleAssetRegistered(ce);
        this.logger.info("Parsed module.asset.registered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          assetCount: event.assets.length,
          clientId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.asset.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.asset.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.asset.deregistered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.asset.deregistered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleAssetDeregistered(ce);
        this.logger.info("Parsed module.asset.deregistered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          assetCount: event.assets.length,
          clientId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.asset.deregistered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.asset.deregistered NATS event", { err });
      }
    });

    // Module resource instance lifecycle — fired by db-proxy after each
    // CreateResourceInstance / DeleteResourceInstance RPC. Forwarded to
    // the registered Convex webhook so UI pickers backed by
    // `resource_ref(kind=...)` ConfigFields refresh live.
    await this.nats.subscribe("db.module.resource.instance.created.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.resource.instance.created.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleResourceInstanceCreated(ce);
        this.logger.info("Parsed module.resource.instance.created", {
          canonicalId: event.instance.canonicalId,
          kind: event.instance.kind,
          displayName: event.instance.displayName,
          clientId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.resource.instance.created");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.resource.instance.created NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.resource.instance.deleted.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.resource.instance.deleted.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleResourceInstanceDeleted(ce);
        this.logger.info("Parsed module.resource.instance.deleted", {
          canonicalId: event.instance.canonicalId,
          kind: event.instance.kind,
          clientId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.resource.instance.deleted");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.resource.instance.deleted NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.installed.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.installed.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const payload = (ce.data ?? ce) as {
          module_id?: string;
          module_name?: string;
          module_key?: string;
          version?: string;
          author?: string;
          category?: string;
          description?: string;
        };
        const clientId = (ce.client_id as string) ?? "";
        this.logger.info("Parsed module.installed event", { payload, clientId });
        const moduleName = payload.module_name ?? "";
        const moduleVersion = payload.version ?? "";
        const moduleKey = payload.module_key ?? "";
        // Catalog metadata extracted server-side from the stored
        // manifest. The engine guarantees author/category are non-empty
        // ("Unknown" when absent); description may be blank when the
        // manifest declared none.
        const author = payload.author ?? "";
        const category = payload.category ?? "";
        const description = payload.description ?? "";

        if (this.webhookClient) {
          this.logger.info("Sending module.installed to webhook client", {
            moduleName,
            moduleVersion,
            moduleKey,
            clientId,
          });
          await this.webhookClient.send(
            {
              type: "module.installed",
              moduleName,
              version: moduleVersion,
              moduleKey,
              author,
              category,
              description,
            },
            clientId || undefined
          );
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.installed");
        }
      } catch (err) {
        this.logger.error("Failed to handle module installed NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.deleted.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.deleted.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const payload = (ce.data ?? ce) as { module_id?: string; module_name?: string; module_key?: string };
        const clientId = (ce.client_id as string) ?? "";
        this.logger.info("Parsed module.deleted event", { payload, clientId });
        const moduleName = payload.module_name ?? "";
        const moduleKey = payload.module_key ?? "";
        if (this.webhookClient) {
          await this.webhookClient.send(
            {
              type: "module.deleted",
              moduleName,
              moduleKey,
            },
            clientId || undefined
          );
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.deleted");
        }
      } catch (err) {
        this.logger.error("Failed to handle module deleted NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.delete_failed.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.delete_failed.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const payload = (ce.data ?? ce) as {
          module_id?: string;
          module_name?: string;
          module_key?: string;
          error?: string;
          in_use_resources?: Array<{
            resource_id?: string;
            resource_type?: string;
            resource_name?: string;
            resource_display_name?: string;
            used_by?: Array<{ source_type?: string; source_id?: string; source_name?: string; context?: string }>;
          }>;
        };
        const clientId = (ce.client_id as string) ?? "";
        const moduleName = payload.module_name ?? "";
        const moduleKey = payload.module_key ?? "";
        const error = payload.error ?? "Unknown error";
        const inUseResources = (payload.in_use_resources ?? []).map((r) => ({
          resourceId: r.resource_id ?? "",
          resourceType: r.resource_type ?? "",
          resourceName: r.resource_name ?? "",
          resourceDisplayName: r.resource_display_name ?? "",
          usedBy: (r.used_by ?? []).map((u) => ({
            sourceType: u.source_type ?? "",
            sourceId: u.source_id ?? "",
            sourceName: u.source_name ?? "",
            context: u.context ?? "",
          })),
        }));
        this.logger.info("Parsed module.delete_failed event", {
          moduleName,
          moduleKey,
          error,
          inUseCount: inUseResources.length,
          clientId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(
            {
              type: "module.delete_failed",
              moduleName,
              moduleKey,
              error,
              inUseResources,
            },
            clientId || undefined
          );
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.delete_failed");
        }
      } catch (err) {
        this.logger.error("Failed to handle module delete_failed NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.install_failed.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.install_failed.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const payload = (ce.data ?? ce) as {
          module_id?: string;
          module_name?: string;
          module_key?: string;
          version?: string;
          error?: string;
        };
        const clientId = (ce.client_id as string) ?? "";
        this.logger.info("Parsed module.install_failed event", { payload, clientId });
        const moduleName = payload.module_name ?? "";
        const moduleVersion = payload.version ?? "";
        const moduleKey = payload.module_key ?? "";
        const errorMsg = payload.error ?? "Unknown error";
        this.logger.error("Module install failed", { moduleName, moduleVersion, moduleKey, error: errorMsg, clientId });

        if (this.webhookClient) {
          this.logger.info("Sending module.install_failed to webhook client", {
            moduleName,
            moduleVersion,
            moduleKey,
            error: errorMsg,
            clientId,
          });
          await this.webhookClient.send(
            {
              type: "module.install_failed",
              moduleName,
              version: moduleVersion,
              moduleKey,
              error: errorMsg,
            },
            clientId || undefined
          );
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.install_failed");
        }
      } catch (err) {
        this.logger.error("Failed to handle module install_failed NATS event", { err });
      }
    });

    // Workflow lifecycle events from the db proxy. Required so workflows
    // created by side-channels other than the api's own createWorkflow
    // RPC reach the UI — most notably the workflows declared in a
    // module manifest, which barkloader registers via Twirp directly
    // against the db proxy and never flow through api.ts:createWorkflow.
    // The inline emits in createWorkflow / updateWorkflow / deleteWorkflow
    // remain for now; the UI's webhook handler upserts on workflow id
    // so the duplicate is idempotent.
    await this.nats.subscribe("db.workflow.created.*", async (msg) => {
      this.logger.info("Received NATS message on db.workflow.created.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseWorkflowCreated(ce);
        if (!event) {
          this.logger.warn("workflow.created payload missing required fields, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed workflow.created", {
          applicationId,
          clientId,
          workflowId: event.workflow.id,
          name: event.workflow.definition?.name,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for workflow.created");
        }
      } catch (err) {
        this.logger.error("Failed to handle workflow.created NATS event", { err });
      }
    });

    await this.nats.subscribe("db.workflow.updated.*", async (msg) => {
      this.logger.info("Received NATS message on db.workflow.updated.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseWorkflowUpdated(ce);
        if (!event) {
          this.logger.warn("workflow.updated payload missing required fields, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed workflow.updated", {
          applicationId,
          clientId,
          workflowId: event.workflow.id,
          name: event.workflow.definition?.name,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for workflow.updated");
        }
      } catch (err) {
        this.logger.error("Failed to handle workflow.updated NATS event", { err });
      }
    });

    await this.nats.subscribe("db.workflow.deleted.*", async (msg) => {
      this.logger.info("Received NATS message on db.workflow.deleted.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseWorkflowDeleted(ce);
        if (!event) {
          this.logger.warn("workflow.deleted payload missing workflow id, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed workflow.deleted", {
          applicationId,
          clientId,
          workflowId: event.workflowId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for workflow.deleted");
        }
      } catch (err) {
        this.logger.error("Failed to handle workflow.deleted NATS event", { err });
      }
    });

    // Scene CRUD outbox — db proxy publishes on
    // `db.scene.{created,updated,deleted}.<applicationId>` after every
    // scene mutation. Forward each through the Bearer-auth callback
    // channel so Convex can sync its scene editor without polling.
    await this.nats.subscribe("db.scene.created.*", async (msg) => {
      this.logger.info("Received NATS message on db.scene.created.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseSceneCreated(ce);
        if (!event) {
          this.logger.warn("scene.created payload missing required fields, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed scene.created", {
          applicationId,
          clientId,
          sceneId: event.scene.id,
          name: event.scene.name,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for scene.created");
        }
      } catch (err) {
        this.logger.error("Failed to handle scene.created NATS event", { err });
      }
    });

    await this.nats.subscribe("db.scene.updated.*", async (msg) => {
      this.logger.info("Received NATS message on db.scene.updated.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseSceneUpdated(ce);
        if (!event) {
          this.logger.warn("scene.updated payload missing required fields, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed scene.updated", {
          applicationId,
          clientId,
          sceneId: event.scene.id,
          name: event.scene.name,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for scene.updated");
        }
      } catch (err) {
        this.logger.error("Failed to handle scene.updated NATS event", { err });
      }
    });

    await this.nats.subscribe("db.scene.deleted.*", async (msg) => {
      this.logger.info("Received NATS message on db.scene.deleted.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseSceneDeleted(ce);
        if (!event) {
          this.logger.warn("scene.deleted payload missing scene id, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed scene.deleted", {
          applicationId,
          clientId,
          sceneId: event.sceneId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for scene.deleted");
        }
      } catch (err) {
        this.logger.error("Failed to handle scene.deleted NATS event", { err });
      }
    });

    // Alert log outbox. db proxy publishes when a row is created
    // (every recorded ui.notify.alert dispatch) or updated (today
    // only the replay status flip surfaces). We project both into
    // webhook events so the Convex alert-log page sees new rows in
    // real time without polling.
    await this.nats.subscribe("db.alert.created.*", async (msg) => {
      this.logger.info("Received NATS message on db.alert.created.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseAlertCreated(ce);
        if (!event) {
          this.logger.warn("alert.created payload missing required fields, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed alert.recorded", {
          applicationId,
          clientId,
          alertId: event.alert.id,
          status: event.alert.status,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for alert.recorded");
        }
      } catch (err) {
        this.logger.error("Failed to handle alert.created NATS event", { err });
      }
    });

    await this.nats.subscribe("db.alert.updated.*", async (msg) => {
      this.logger.info("Received NATS message on db.alert.updated.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseAlertUpdated(ce);
        if (!event) {
          // Lifecycle transitions that don't have a webhook surface
          // (today: `"playing"`) intentionally drop here — see
          // `parseAlertUpdated` for the projection map.
          return;
        }
        this.logger.info("Parsed alert lifecycle update", {
          applicationId,
          clientId,
          alertId: event.alert.id,
          eventType: event.type,
          status: event.alert.status,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback", {
            eventType: event.type,
          });
        }
      } catch (err) {
        this.logger.error("Failed to handle alert.updated NATS event", { err });
      }
    });

    // db.widget_status.updated.{appId} — db proxy outbox event fired
    // by `widgetStatusService.publishChange` whenever the streamware
    // orchestrator upserts a widget_status row. Project to the
    // dashboard via the WIDGET_STATUS_CHANGED webhook. Same boundary
    // pattern as the alert / module / scene / workflow projections.
    await this.nats.subscribe("db.widget_status.updated.*", async (msg) => {
      try {
        const ce = msg.json() as Record<string, unknown>;
        const data = (ce.data as Record<string, unknown> | undefined) ?? (ce as Record<string, unknown>);
        const moduleId =
          typeof data.module_id === "string"
            ? (data.module_id as string)
            : typeof data.ModuleID === "string"
              ? (data.ModuleID as string)
              : "";
        const instanceId =
          typeof data.instance_id === "string"
            ? (data.instance_id as string)
            : typeof data.InstanceID === "string"
              ? (data.InstanceID as string)
              : "";
        const key =
          typeof data.key === "string"
            ? (data.key as string)
            : typeof data.Key === "string"
              ? (data.Key as string)
              : "";
        if (!moduleId || !instanceId || !key) {
          this.logger.warn("db.widget_status.updated: missing required fields; dropping", {
            moduleId,
            instanceId,
            key,
          });
          return;
        }
        const widgetCanonicalId =
          typeof data.widget_canonical_id === "string"
            ? (data.widget_canonical_id as string)
            : typeof data.WidgetCanonicalID === "string"
              ? (data.WidgetCanonicalID as string)
              : "";
        const occurredAt =
          typeof data.occurred_at === "string"
            ? (data.occurred_at as string)
            : typeof data.OccurredAt === "string"
              ? (data.OccurredAt as string)
              : new Date().toISOString();
        const applicationId =
          typeof ce.application_id === "string"
            ? (ce.application_id as string)
            : typeof data.application_id === "string"
              ? (data.application_id as string)
              : "";
        if (!applicationId) {
          this.logger.warn("db.widget_status.updated: missing applicationId; dropping", {
            moduleId,
            instanceId,
            key,
          });
          return;
        }
        // The db proxy serialises `value` as a JSONB-stringified form.
        // Round-trip parse so the webhook payload carries the typed
        // shape consumers expect.
        let parsedValue: unknown = null;
        const rawValue = data.value ?? data.Value;
        if (typeof rawValue === "string") {
          try {
            parsedValue = JSON.parse(rawValue);
          } catch {
            parsedValue = rawValue;
          }
        } else if (rawValue !== undefined) {
          parsedValue = rawValue;
        }
        if (this.webhookClient) {
          await this.webhookClient.send({
            type: EngineEventType.WIDGET_STATUS_CHANGED,
            applicationId,
            moduleId,
            instanceId,
            widgetCanonicalId: widgetCanonicalId || undefined,
            key,
            value: parsedValue,
            occurredAt,
          });
        }
        this.logger.info("widget status webhook dispatched", {
          applicationId,
          moduleId,
          instanceId,
          key,
        });
      } catch (err) {
        this.logger.error("db.widget_status.updated: handler failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Twitch stream lifecycle. The twitch service publishes
    // `online.user.twitch` / `offline.user.twitch` cloudevents from
    // its EventSub listener; we translate them to the webhook
    // `stream.online` / `stream.offline` events the UI subscribes to.
    //
    // applicationId is resolved lazily from the default application —
    // the engine is single-broadcaster-per-deployment today, so every
    // emitted event scopes to the same id. The `_d` is the raw
    // CloudEvent data; we read the broadcaster fields directly.
    await this.nats.subscribe("online.user.twitch", async (msg) => {
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
        let enrichment: Awaited<ReturnType<typeof this.getStreamStatus>> | null = null;
        try {
          enrichment = await this.getStreamStatus("");
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
        this.logger.error("online.user.twitch: handler failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await this.nats.subscribe("offline.user.twitch", async (msg) => {
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
        this.logger.error("offline.user.twitch: handler failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    this.logger.info("NATS subscriptions initialized for module events");
  }
};
