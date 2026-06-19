import type { Api } from "./api";

/**
 * Match and handle GET/PUT module settings HTTP routes.
 *
 * Routes:
 *   GET  /modules/:moduleId/settings        -> ModuleSettingsResponse
 *   PUT  /modules/:moduleId/settings/:key   -> ModuleSetting (body: { value: string })
 *
 * Returns a Response when the path matches, or null when it does not.
 * The caller should fall through to its normal routing when null is returned.
 */
export async function handleModuleSettingRoute(req: Request, url: URL, api: Api): Promise<Response | null> {
  const path = url.pathname;

  // GET /modules/:moduleId/settings
  const listMatch = path.match(/^\/modules\/([^/]+)\/settings$/);
  if (listMatch && req.method === "GET") {
    const moduleId = decodeURIComponent(listMatch[1]);
    const result = await api.getModuleSettings(moduleId);
    return Response.json(result);
  }

  // PUT /modules/:moduleId/settings/:key
  const setMatch = path.match(/^\/modules\/([^/]+)\/settings\/([^/]+)$/);
  if (setMatch && req.method === "PUT") {
    const moduleId = decodeURIComponent(setMatch[1]);
    const key = decodeURIComponent(setMatch[2]);
    const body = (await req.json()) as { value?: unknown };
    if (typeof body.value !== "string") {
      return new Response(JSON.stringify({ error: "body.value must be a string" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const result = await api.updateModuleSetting(moduleId, key, body.value);
    return Response.json(result);
  }

  return null;
}
