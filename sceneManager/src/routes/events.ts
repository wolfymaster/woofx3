import type { Logger } from "@woofx3/common/runtime";
import { type AckRefusal, encodeStreamFrame, KEEPALIVE_FRAME, parseAckBody } from "../../contract/overlay-stream";
import { type AlertLifecycleWriter, alertReportTargets, updateAlertLifecycle } from "../events/alert-dispatch";
import { handleStatusReport } from "../events/handlers";
import type { HttpDeps } from "../http";
import { BODY_LIMITS, invalidSession, jsonError, jsonOk, readJsonBody, requireSceneSession } from "./http-kit";

/**
 * SSE comment-frame heartbeat interval. Must stay comfortably below
 * both `idleTimeout` in http.ts and any proxy's idle timeout on the
 * path, so the stream is never the thing that goes quiet first.
 */
const SSE_HEARTBEAT_MS = 20_000;

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
    if ((await requireSceneSession(req, sceneId, deps.sessionTokens)) === null) {
      return invalidSession();
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
        controller.enqueue(
          encoder.encode(
            encodeStreamFrame({
              kind: "hello",
              bootId: deps.bootId,
              seq: deps.sceneDocuments.seqOf(sceneId, "published"),
              draftSeq: deps.sceneDocuments.seqOf(sceneId, "draft"),
            })
          )
        );
        // A scene can sit idle far longer than any idle timeout on the
        // path: Bun.serve reaps a silent connection (see `idleTimeout`
        // in http.ts), and reverse proxies do the same. Without this
        // the stream is torn down and rebuilt every few seconds, which
        // flashes the Disconnected banner and re-runs the open-delivery
        // replay on every cycle. The client parses comment frames as
        // no-ops (parseSseChunk), so a heartbeat costs nothing there.
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(KEEPALIVE_FRAME));
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

/** `POST /scene/{sceneId}/events/{eventId}/delivered` — body
 *  `{ instanceIds: string[] }`, batched per the design note (a burst
 *  of events shouldn't mean a burst of single-item HTTP calls). */
export async function handleEventDeliveredRoute(
  req: Request,
  sceneId: string,
  eventId: string,
  deps: HttpDeps
): Promise<Response> {
  if ((await requireSceneSession(req, sceneId, deps.sessionTokens)) === null) {
    return invalidSession();
  }
  const body = await readJsonBody(req, BODY_LIMITS.ack);
  if (!body.ok) {
    return body.response;
  }
  const instanceIds = parseAckBody(body.value);
  if (!instanceIds) {
    return jsonError(400, "invalid_body");
  }
  const failed = await deps.deliveryStore.ackDelivered(sceneId, eventId, instanceIds);
  return ackAnswer(failed);
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
  if ((await requireSceneSession(req, sceneId, deps.sessionTokens)) === null) {
    return invalidSession();
  }
  const body = await readJsonBody(req, BODY_LIMITS.ack);
  if (!body.ok) {
    return body.response;
  }
  const instanceIds = parseAckBody(body.value);
  if (!instanceIds) {
    return jsonError(400, "invalid_body");
  }
  const firsts = deps.deliveryStore.markStarted(sceneId, eventId, instanceIds);
  await reportAlertsPlaying(deps.ctx.services.db.client, deps.ctx.logger, firsts);
  return jsonOk({ status: "ok" });
}

/**
 * Report each widget instance's first start of an alert, best-effort. The
 * alert's row moves to `playing` on the first report; the db proxy refuses
 * the rest, since the row has already moved there or past it, and publishes
 * nothing for them.
 */
export async function reportAlertsPlaying(
  db: AlertLifecycleWriter,
  logger: Logger,
  started: Array<{ type: string; key: string; value: unknown }>
): Promise<void> {
  for (const target of alertReportTargets(started)) {
    try {
      await updateAlertLifecycle(db, target, "playing", "");
    } catch (err) {
      logger.debug("alert start not recorded", {
        alertId: target.envelopeId,
        rowId: target.rowId,
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
  if ((await requireSceneSession(req, sceneId, deps.sessionTokens)) === null) {
    return invalidSession();
  }
  const body = await readJsonBody(req, BODY_LIMITS.ack);
  if (!body.ok) {
    return body.response;
  }
  const instanceIds = parseAckBody(body.value);
  if (!instanceIds) {
    return jsonError(400, "invalid_body");
  }
  const { closed, failed } = await deps.deliveryStore.ackCompleted(sceneId, eventId, instanceIds);
  await reportAlertsCompleted(deps.ctx.services.db.client, deps.ctx.logger, closed);
  return ackAnswer(failed);
}

/**
 * 503 when some of an ack could not be recorded, so the page sends it again
 * (see ack-batcher.ts); acks are idempotent, so resending what did land is
 * harmless.
 */
function ackAnswer(failed: string[]): Response {
  if (failed.length > 0) {
    const refusal: AckRefusal = { error: "unavailable", instanceIds: failed };
    return jsonError(503, refusal.error, { instanceIds: refusal.instanceIds });
  }
  return jsonOk({ status: "ok" });
}

/**
 * A page finishing an alert moves its row to `completed`, best-effort.
 *
 * This is the alert's only terminal report when it plays normally: without it
 * the row stays at `playing` and the dashboard counts it in flight forever.
 * An alert fanned out to several widgets completes on the first one to finish;
 * the db proxy refuses the others' reports of the same verdict and publishes
 * nothing for them.
 */
export async function reportAlertsCompleted(
  db: AlertLifecycleWriter,
  logger: Logger,
  closed: Array<{ type: string; key: string; value: unknown }>
): Promise<void> {
  for (const target of alertReportTargets(closed)) {
    try {
      await updateAlertLifecycle(db, target, "completed", "");
    } catch (err) {
      logger.debug("alert completion not recorded", {
        alertId: target.envelopeId,
        rowId: target.rowId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

interface StatusReportBody {
  moduleId?: unknown;
  widgetCanonicalId?: unknown;
  key?: unknown;
  value?: unknown;
  ts?: unknown;
}

/**
 * The module a status report is filed under. For a scene placement it is the
 * placement's, from the scene's documents. An alert's widget is addressed as
 * `{eventId}.{widgetId}`, which is no scene placement: its module is the one
 * the page read from the alert layout it was delivered. Neither comes from
 * the widget, whose `hello` claim nothing checks.
 */
async function statusModuleOf(
  deps: HttpDeps,
  sceneId: string,
  instanceId: string,
  body: StatusReportBody
): Promise<string> {
  try {
    const placed = await deps.sceneDocuments.placementMeta(sceneId, instanceId);
    if (placed !== null) {
      return placed.moduleId;
    }
  } catch (err) {
    deps.ctx.logger.warn("widget status: scene unavailable; filing under the page's module", {
      sceneId,
      instanceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return typeof body.moduleId === "string" ? body.moduleId : "";
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
  if ((await requireSceneSession(req, sceneId, deps.sessionTokens)) === null) {
    return invalidSession();
  }
  const read = await readJsonBody(req, BODY_LIMITS.status);
  if (!read.ok) {
    return read.response;
  }
  const body = read.value as StatusReportBody | null;
  if (typeof body !== "object" || body === null || typeof body.key !== "string" || body.key.length === 0) {
    return jsonError(400, "invalid_body");
  }

  await handleStatusReport(deps.ctx.services.db.client, deps.ctx.logger, {
    moduleId: await statusModuleOf(deps, sceneId, instanceId, body),
    instanceId,
    widgetCanonicalId: typeof body.widgetCanonicalId === "string" ? body.widgetCanonicalId : undefined,
    key: body.key,
    value: body.value,
    occurredAt: typeof body.ts === "string" ? body.ts : undefined,
  });
  return jsonOk({ status: "ok" });
}
