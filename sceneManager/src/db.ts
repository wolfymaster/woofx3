import { Ping } from "@woofx3/db/common.pb";
import type * as common from "@woofx3/db/common.pb";
import * as overlay_token from "@woofx3/db/overlay_token.pb";
import * as scene from "@woofx3/db/scene.pb";
import * as scene_event from "@woofx3/db/scene_event.pb";
import * as setting from "@woofx3/db/setting.pb";
import * as widget_status from "@woofx3/db/widget_status.pb";
import { GetModuleByModuleId, ListWidgets, RegisterWidgets } from "@woofx3/db/module.pb";
import type * as module_widget from "@woofx3/db/module_widget.pb";

// twirpscript ClientConfiguration is { baseURL: string }; inlined so
// sceneManager doesn't need twirpscript as a direct dep (the generated
// `*.pb.ts` files in shared/clients/typescript/db/ pull it in
// transitively) — same rationale as streamware/src/db.ts.
interface ClientConfiguration {
  baseURL: string;
}

/**
 * Twirpscript's TwirpError doesn't extend Error; normalise at this
 * boundary so callers upstream always see a real Error carrying the
 * Twirp code and message. Ported verbatim from streamware/src/db.ts.
 */
function toError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    return err;
  }
  if (err !== null && typeof err === "object") {
    const e = err as { code?: unknown; msg?: unknown };
    const code = typeof e.code === "string" ? e.code : undefined;
    const msg = typeof e.msg === "string" ? e.msg : undefined;
    const detail = [code, msg].filter((part) => part && part.length > 0).join(": ");
    return new Error(`${op}: ${detail.length > 0 ? detail : String(err)}`);
  }
  return new Error(`${op}: ${String(err)}`);
}

/**
 * sceneManager's gRPC(-over-Twirp) client for the db proxy. Per
 * CLAUDE.md ("Only DB communicates with databases"), this is the
 * sanctioned way for sceneManager to read/write engine state.
 *
 * Read-only for scenes — same convention streamware used. Write paths
 * (create/update/delete) stay on the `api` service.
 */
export class DbClient {
  private config: ClientConfiguration;

  constructor(baseUrl: string) {
    this.config = { baseURL: baseUrl };
    return new Proxy(this, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop === "constructor" || typeof value !== "function") {
          return value;
        }
        const method = value as (...args: unknown[]) => unknown;
        return async function wrapped(this: unknown, ...args: unknown[]) {
          try {
            return await method.apply(this, args);
          } catch (err) {
            throw toError(err, `db.${String(prop)}`);
          }
        };
      },
    });
  }

  async ping(): Promise<void> {
    await Ping({}, this.config);
  }

  // Scene reads — sceneManager fetches a scene by id when `/scene/{id}`
  // loads. Write paths stay on the api service.
  async getScene(req: scene.GetSceneRequest): Promise<scene.SceneResponse> {
    return scene.GetScene(req, this.config);
  }

  // Overlay-token resolution — engine-internal only. sceneManager is
  // the single resolver of plaintext tokens (streamware's role,
  // carried over); the api gateway never resolves them.
  async resolveOverlayToken(
    req: overlay_token.ResolveOverlayTokenRequest
  ): Promise<overlay_token.ResolveOverlayTokenResponse> {
    return overlay_token.ResolveOverlayToken(req, this.config);
  }

  async listWidgets(req: module_widget.ListWidgetsRequest): Promise<module_widget.ListWidgetsResponse> {
    return ListWidgets(req, this.config);
  }

  async registerWidgets(req: module_widget.RegisterWidgetsRequest): Promise<module_widget.ListWidgetsResponse> {
    return RegisterWidgets(req, this.config);
  }

  // Resolves a module's current composite module_key from its stable
  // manifest id — used for built-in widget catalog registration parity
  // checks. Module-widget frame resolution itself now happens
  // server-to-server against Barkloader's own endpoint, not here.
  async getModuleKeyForModuleId(moduleId: string): Promise<string | null> {
    const resp = await GetModuleByModuleId({ moduleId }, this.config);
    return resp.module?.moduleKey || null;
  }

  async upsertWidgetStatus(req: widget_status.UpsertWidgetStatusRequest): Promise<widget_status.WidgetStatusResponse> {
    return widget_status.UpsertWidgetStatus(req, this.config);
  }

  async getSetting(key: string, applicationId: string): Promise<string | null> {
    const resp = await setting.GetSetting({ key, applicationId }, this.config);
    return resp.setting?.value?.stringValue ?? null;
  }

  // Durable, at-least-once scene event delivery (see scene_event.proto
  // and delivery-store.ts).
  async recordSceneEvent(req: scene_event.RecordSceneEventRequest): Promise<scene_event.SceneEventResponse> {
    return scene_event.RecordSceneEvent(req, this.config);
  }

  async recordSceneEventDelivery(req: scene_event.RecordDeliveryRequest): Promise<common.ResponseStatus> {
    return scene_event.RecordDelivery(req, this.config);
  }

  async recordSceneEventCompletion(req: scene_event.RecordCompletionRequest): Promise<common.ResponseStatus> {
    return scene_event.RecordCompletion(req, this.config);
  }

  async listOpenSceneEventDeliveries(
    req: scene_event.ListOpenSceneEventDeliveriesRequest
  ): Promise<scene_event.ListOpenSceneEventDeliveriesResponse> {
    return scene_event.ListOpenSceneEventDeliveries(req, this.config);
  }

  async getSceneEvent(req: scene_event.GetSceneEventRequest): Promise<scene_event.SceneEventResponse> {
    return scene_event.GetSceneEvent(req, this.config);
  }

  async listSceneEventLog(req: scene_event.ListSceneEventLogRequest): Promise<scene_event.ListSceneEventLogResponse> {
    return scene_event.ListSceneEventLog(req, this.config);
  }
}

export type {
  ListOpenSceneEventDeliveriesResponse,
  RecordDeliveryRequest,
  RecordCompletionRequest,
  RecordSceneEventRequest,
  SceneEvent,
  SceneEventDelivery,
  SceneEventLogEntry,
  SceneEventResponse,
} from "@woofx3/db/scene_event.pb";
export type { ResolveOverlayTokenRequest, ResolveOverlayTokenResponse } from "@woofx3/db/overlay_token.pb";
export type { ListWidgetsResponse, RegisterWidgetsRequest, WidgetInput } from "@woofx3/db/module_widget.pb";
export type { UpsertWidgetStatusRequest, WidgetStatusResponse } from "@woofx3/db/widget_status.pb";
export type { ResponseStatus } from "@woofx3/db/common.pb";
