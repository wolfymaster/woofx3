import type { PlacementMeta } from "@woofx3/api/scene-editor";
import type { HttpDeps } from "../http";
import { storageModuleFor } from "../scene/module-state";
import { invalidSession, jsonError, jsonOk, requireSceneSession } from "./http-kit";

/**
 * `GET /scene/{sceneId}/widget/{instanceId}/storage?key={key}` — the current
 * value of one key in the storage of the module a placed widget belongs to, as
 * `{ value }`, and from then on every change to it on the scene's event stream
 * (see scene/module-state.ts).
 *
 * Addressed by placement rather than by module: a widget names its module in
 * its `hello`, and nothing checks that claim, so the module is taken from the
 * scene record instead. A widget reads its own module's storage, and beyond it
 * only the value of a resource instance its module's settings link, read from
 * the instance owner's storage (see `storageModuleFor`), and its own module's
 * `list` settings, at `setting:<settingId>`.
 *
 * The placement is looked up in the scene's held documents
 * (`SceneDocuments.placementMeta`), so a widget added in the editor's preview,
 * or added live, is answered before the scene is written back.
 *
 * The key travels as a query parameter because storage keys carry colons
 * (`state:woofx3:counter:deaths`).
 */
export async function handleWidgetStorageRoute(
  req: Request,
  sceneId: string,
  instanceId: string,
  deps: HttpDeps
): Promise<Response> {
  if ((await requireSceneSession(req, sceneId, deps.sessionTokens)) === null) {
    return invalidSession();
  }
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (key === "") {
    return jsonError(400, "missing_key");
  }

  let instance: PlacementMeta | null;
  try {
    instance = await placedWidget(deps, sceneId, instanceId);
  } catch (err) {
    deps.ctx.logger.warn("widget storage: scene unavailable", {
      sceneId,
      instanceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError(502, "unavailable");
  }
  if (!instance) {
    return jsonError(404, "not_found");
  }

  try {
    const readFrom = await storageModuleFor(deps.settingsDb, instance.moduleId, key);
    const value = await deps.moduleState.read(sceneId, readFrom, key, instance.moduleId);
    return jsonOk({ value });
  } catch (err) {
    deps.ctx.logger.warn("widget storage read failed", {
      sceneId,
      instanceId,
      moduleId: instance.moduleId,
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError(502, "unavailable");
  }
}

/**
 * The meta of a placement on either version of the scene, or null when it is
 * on neither or hosts a surface: such a placement is drawn by the page and
 * has no module code to read for.
 */
async function placedWidget(deps: HttpDeps, sceneId: string, instanceId: string): Promise<PlacementMeta | null> {
  const meta = await deps.sceneDocuments.placementMeta(sceneId, instanceId);
  return meta !== null && meta.hostsSurface === "" ? meta : null;
}
