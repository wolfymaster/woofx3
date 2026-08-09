import type { HttpDeps } from "../http";
import { readSessionCookie } from "../scene/session-cookie";
import { handleStatusReport } from "../events/handlers";

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "invalid_session" }), {
    status: 401,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function verifySession(req: Request, sceneId: string, deps: HttpDeps): Promise<boolean> {
  const cookie = readSessionCookie(req);
  const claims = cookie ? await deps.sessionTokens.verify(cookie) : null;
  return !!claims && claims.sceneId === sceneId;
}

/**
 * `GET /scene/{sceneId}/events` — the SSE stream. Opening a connection
 * *is* "the frontend registers to start receiving events" (see
 * DeliveryStore.subscribe, which replays every open delivery
 * immediately). Held open for the lifetime of the page; sceneManager
 * relies on the browser's own reconnect/backoff (event-source.ts) to
 * re-establish it after a drop.
 */
export function handleEventsStreamRoute(req: Request, sceneId: string, deps: HttpDeps): Promise<Response> {
  return (async () => {
    if (!(await verifySession(req, sceneId, deps))) {
      return unauthorized();
    }

    let unsubscribe: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        unsubscribe = deps.deliveryStore.subscribe(sceneId, controller);
        // Comment frame: nudges the connection open immediately in
        // browsers/proxies that buffer until the first byte.
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
      },
      cancel() {
        unsubscribe?.();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    });
  })();
}

interface AckBody {
  instanceIds?: unknown;
}

function parseInstanceIds(body: unknown): string[] | null {
  const b = body as AckBody;
  if (!Array.isArray(b.instanceIds) || b.instanceIds.length === 0) {
    return null;
  }
  if (!b.instanceIds.every((v): v is string => typeof v === "string" && v.length > 0)) {
    return null;
  }
  return b.instanceIds;
}

/** `POST /scene/{sceneId}/events/{eventId}/delivered` — body
 *  `{ instanceIds: string[] }`, batched per the design note (a burst
 *  of events shouldn't mean a burst of single-item HTTP calls). */
export async function handleEventDeliveredRoute(
  req: Request,
  sceneId: string,
  eventId: string,
  deps: HttpDeps
): Promise<Response> {
  if (!(await verifySession(req, sceneId, deps))) {
    return unauthorized();
  }
  const instanceIds = parseInstanceIds(await req.json().catch(() => null));
  if (!instanceIds) {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 });
  }
  await deps.deliveryStore.ackDelivered(sceneId, eventId, instanceIds);
  return Response.json({ status: "ok" });
}

/** `POST /scene/{sceneId}/events/{eventId}/completed` — same body shape. */
export async function handleEventCompletedRoute(
  req: Request,
  sceneId: string,
  eventId: string,
  deps: HttpDeps
): Promise<Response> {
  if (!(await verifySession(req, sceneId, deps))) {
    return unauthorized();
  }
  const instanceIds = parseInstanceIds(await req.json().catch(() => null));
  if (!instanceIds) {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 });
  }
  await deps.deliveryStore.ackCompleted(sceneId, eventId, instanceIds);
  return Response.json({ status: "ok" });
}

interface StatusReportBody {
  moduleId?: unknown;
  widgetCanonicalId?: unknown;
  key?: unknown;
  value?: unknown;
  ts?: unknown;
}

/** `POST /scene/{sceneId}/widget/{instanceId}/status` — widget
 *  `status.report` (both `reportStatus` calls and `event.complete()`'s
 *  optional accompanying status). */
export async function handleWidgetStatusRoute(
  req: Request,
  sceneId: string,
  instanceId: string,
  deps: HttpDeps
): Promise<Response> {
  const cookie = readSessionCookie(req);
  const claims = cookie ? await deps.sessionTokens.verify(cookie) : null;
  if (!claims || claims.sceneId !== sceneId) {
    return unauthorized();
  }
  const body = (await req.json().catch(() => null)) as StatusReportBody | null;
  if (!body || typeof body.key !== "string" || body.key.length === 0) {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 });
  }

  await handleStatusReport(deps.ctx.services.db.client, deps.ctx.logger, {
    applicationId: claims.applicationId,
    moduleId: typeof body.moduleId === "string" ? body.moduleId : "",
    instanceId,
    widgetCanonicalId: typeof body.widgetCanonicalId === "string" ? body.widgetCanonicalId : undefined,
    key: body.key,
    value: body.value,
    occurredAt: typeof body.ts === "string" ? body.ts : undefined,
  });
  return Response.json({ status: "ok" });
}
