import type { Logger } from "@woofx3/common/runtime";
import type { AlertLifecycleWriter } from "../events/alert-dispatch";
import { handleStatusReport } from "../events/handlers";
import type { HttpDeps } from "../http";
import { ALERT_EVENT_TYPE } from "../scene/alert-layout";
import { readSessionCookie } from "../scene/session-cookie";

/**
 * SSE comment-frame heartbeat interval. Must stay comfortably below
 * both `idleTimeout` in http.ts and any proxy's idle timeout on the
 * path, so the stream is never the thing that goes quiet first.
 */
const SSE_HEARTBEAT_MS = 20_000;

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "invalid_session" }), {
    status: 401,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function verifySession(req: Request, sceneId: string, deps: HttpDeps): Promise<boolean> {
  const cookie = readSessionCookie(req, sceneId);
  const claims = cookie ? await deps.sessionTokens.verify(cookie) : null;
  return !!claims && claims.sceneId === sceneId;
}

/**
 * `GET /scene/{sceneId}/events` — the SSE stream. Opening a connection
 * *is* "the frontend registers to start receiving events" (see
 * DeliveryStore.subscribe, which replays every open delivery
 * immediately). Held open for the lifetime of the page; sceneManager
 * relies on the client's own reconnect/backoff (event-source.ts) to
 * re-establish it after a drop.
 */
export function handleEventsStreamRoute(req: Request, sceneId: string, deps: HttpDeps): Promise<Response> {
  return (async () => {
    if (!(await verifySession(req, sceneId, deps))) {
      return unauthorized();
    }

    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        unsubscribe = deps.deliveryStore.subscribe(sceneId, controller);
        // Opening frame: nudges the connection open immediately in
        // browsers/proxies that buffer until the first byte, and
        // carries this process's boot identity so a reconnecting
        // overlay can detect that it came back to a *restarted*
        // sceneManager rather than resuming against the same one.
        // It also says which scene ops the overlay should be up to, so one
        // that missed some while its stream was down resyncs.
        const hello = {
          bootId: deps.bootId,
          seq: deps.sceneDocuments.seqOf(sceneId, "published"),
          draftSeq: deps.sceneDocuments.seqOf(sceneId, "draft"),
        };
        controller.enqueue(encoder.encode(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`));
        // A scene can sit idle far longer than any idle timeout on the
        // path: Bun.serve reaps a silent connection (see `idleTimeout`
        // in http.ts), and reverse proxies do the same. Without this
        // the stream is torn down and rebuilt every few seconds, which
        // flashes the Disconnected banner and re-runs the open-delivery
        // replay on every cycle. The client parses comment frames as
        // no-ops (parseSseChunk), so a heartbeat costs nothing there.
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            // Already closed from the other end — stop pumping.
            if (heartbeat !== null) {
              clearInterval(heartbeat);
              heartbeat = null;
            }
          }
        }, SSE_HEARTBEAT_MS);
      },
      cancel() {
        if (heartbeat !== null) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
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

/**
 * `POST /scene/{sceneId}/events/{eventId}/started` — same body shape. A page
 * started playing the event on these instances. Sent by alert widgets only,
 * and unbatched: it is how a skip finds the alert on screen (see
 * events/alert-controls.ts), and it moves the alert's row to `playing`.
 */
export async function handleEventStartedRoute(
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
  const firsts = deps.deliveryStore.markStarted(sceneId, eventId, instanceIds);
  await reportAlertsPlaying(deps.ctx.services.db.client, deps.ctx.logger, firsts);
  return Response.json({ status: "ok" });
}

/** The first start report for an alert moves its row to `playing`, best-effort. */
export async function reportAlertsPlaying(
  db: AlertLifecycleWriter,
  logger: Logger,
  started: Array<{ type: string; key: string }>
): Promise<void> {
  const alertIds = new Set(started.filter((delivery) => delivery.type === ALERT_EVENT_TYPE).map((d) => d.key));
  for (const alertId of alertIds) {
    try {
      await db.updateAlertLifecycle({ envelopeId: alertId, status: "playing", error: "" });
    } catch (err) {
      logger.debug("alert start not recorded", {
        alertId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
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
  const cookie = readSessionCookie(req, sceneId);
  const claims = cookie ? await deps.sessionTokens.verify(cookie) : null;
  if (!claims || claims.sceneId !== sceneId) {
    return unauthorized();
  }
  const body = (await req.json().catch(() => null)) as StatusReportBody | null;
  if (!body || typeof body.key !== "string" || body.key.length === 0) {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 });
  }

  await handleStatusReport(deps.ctx.services.db.client, deps.ctx.logger, {
    moduleId: typeof body.moduleId === "string" ? body.moduleId : "",
    instanceId,
    widgetCanonicalId: typeof body.widgetCanonicalId === "string" ? body.widgetCanonicalId : undefined,
    key: body.key,
    value: body.value,
    occurredAt: typeof body.ts === "string" ? body.ts : undefined,
  });
  return Response.json({ status: "ok" });
}
