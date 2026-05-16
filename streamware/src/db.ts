import * as alert from "@woofx3/db/alert.pb";
import * as scene from "@woofx3/db/scene.pb";
import * as widget_status from "@woofx3/db/widget_status.pb";
import { RegisterWidgets } from "@woofx3/db/module.pb";
import type * as module_widget from "@woofx3/db/module_widget.pb";

// twirpscript ClientConfiguration is { baseURL: string }; we inline
// rather than importing the type so streamware doesn't need
// twirpscript as a direct dep (the generated `*.pb.ts` files in
// shared/clients/typescript/db/ pull it in transitively).
interface ClientConfiguration {
  baseURL: string;
}

/**
 * Twirpscript's TwirpError doesn't extend Error, which makes it
 * awkward to surface as a regular failure. Normalise at this
 * boundary so callers upstream always see a real Error carrying
 * the Twirp code and message.
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
 * Streamware-side gRPC client for the db proxy. Mirrors
 * `api/src/db-client.ts` in pattern but exposes only the surface
 * streamware needs — alert lifecycle and widget-status persistence.
 *
 * Per CLAUDE.md ("Only DB communicates with databases. All services
 * use GRPC clients to communicate with the db proxy"), this is the
 * sanctioned way for streamware to read/write engine state. Adding
 * the dependency was deliberately deferred until streamware took on
 * the orchestration role from the api boundary.
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

  async createAlert(req: alert.CreateAlertRequest): Promise<alert.AlertResponse> {
    return alert.CreateAlert(req, this.config);
  }

  async getAlert(req: alert.GetAlertRequest): Promise<alert.AlertResponse> {
    return alert.GetAlert(req, this.config);
  }

  async getAlertByEnvelopeId(req: alert.GetAlertByEnvelopeIdRequest): Promise<alert.AlertResponse> {
    return alert.GetAlertByEnvelopeId(req, this.config);
  }

  async updateAlertStatus(req: alert.UpdateAlertStatusRequest): Promise<alert.AlertResponse> {
    return alert.UpdateAlertStatus(req, this.config);
  }

  async updateAlertLifecycle(req: alert.UpdateAlertLifecycleRequest): Promise<alert.AlertResponse> {
    return alert.UpdateAlertLifecycle(req, this.config);
  }

  async upsertWidgetStatus(req: widget_status.UpsertWidgetStatusRequest): Promise<widget_status.WidgetStatusResponse> {
    return widget_status.UpsertWidgetStatus(req, this.config);
  }

  // Scene reads — streamware fetches a scene by id when the
  // `/overlay/scene/{id}` overlay loads in OBS / the editor preview.
  // Write paths (create/update/delete) stay on the api service;
  // streamware is read-only for scenes.
  async getScene(req: scene.GetSceneRequest): Promise<scene.SceneResponse> {
    return scene.GetScene(req, this.config);
  }

  async registerWidgets(req: module_widget.RegisterWidgetsRequest): Promise<module_widget.ListWidgetsResponse> {
    return RegisterWidgets(req, this.config);
  }

  async listWidgets(req: module_widget.ListWidgetsRequest): Promise<module_widget.ListWidgetsResponse> {
    const { ListWidgets } = await import("@woofx3/db/module.pb");
    return ListWidgets(req, this.config);
  }
}

// Re-export the request types streamware composes against, so callers
// don't need to know about the internal proto package layout.
export type {
  AlertResponse,
  CreateAlertRequest,
  GetAlertRequest,
  GetAlertByEnvelopeIdRequest,
  UpdateAlertLifecycleRequest,
  UpdateAlertStatusRequest,
} from "@woofx3/db/alert.pb";
export type {
  UpsertWidgetStatusRequest,
  WidgetStatusResponse,
} from "@woofx3/db/widget_status.pb";
export type { ResponseStatus } from "@woofx3/db/common.pb";
export type {
  RegisterWidgetsRequest,
  ListWidgetsResponse,
  WidgetInput,
} from "@woofx3/db/module_widget.pb";
