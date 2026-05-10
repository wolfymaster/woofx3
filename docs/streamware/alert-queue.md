# Alert Queue

The alert queue is a per-application FIFO that enforces "one alert at a time" with a lease + timeout policy. It lives at `streamware/src/alert-queue-manager.ts` and is wired into the inbound `widget.event` dispatcher.

## State

```
┌─────────────────────────────────┐    ┌─────────────────────────┐
│ pending queues                  │    │ in-flight leases         │
│  Map<applicationId, Envelope[]> │    │  Map<appId, Lease>       │
│                                 │    │  Lease = { envelope,     │
│  appId → [env1, env2, env3]     │    │            timer }       │
└─────────────────────────────────┘    └─────────────────────────┘
```

State is held in memory. A persistent backstop in the `alerts` table records every envelope's lifecycle (`sent` → `dispatched` → `playing` → `completed` / `failed` / `timed_out` / `skipped` / `replayed`), so a process restart can be resumed manually via the `replayAlert` operator control. Hydrating in-flight + pending state on boot is a follow-up; today, restart drops both.

## Enqueue

`AlertQueueManager.enqueue(envelope)` appends to the per-application queue. If no in-flight lease exists for that application, it dispatches immediately; otherwise the envelope waits its turn.

Envelopes are dropped (with a warning) if they're missing `applicationId` or `id`. The envelope `id` is stamped by the workflow alert action — see `workflow/actions.go` `buildAlertEnvelope` — and is the canonical handle that all three layers (api, streamware, overlay) key on end-to-end.

## Dispatch

`dispatchNext(applicationId)` runs the next envelope through three steps:

1. Update `alerts.status = "dispatched"` so a crash between publish and bookkeeping doesn't leave the row stuck at `pending`.
2. Publish the envelope verbatim on NATS `ui.alert.broadcast`. The broadcaster (`streamware/src/alert-broadcaster.ts:92`) fans out to every connected `/ws/alerts` client.
3. Set a lease timer.

If NATS is unavailable or the publish fails, the envelope is marked `timed_out` with reason `"nats unavailable"` or `"publish failed"`, and the queue advances. The pattern repeats until the queue drains or NATS recovers — the operator sees the failure pattern in the alert log.

## Lease semantics

```
lease_seconds = min(alert_duration_seconds + LEASE_BUFFER, MAX_LEASE)

LEASE_BUFFER = 5 s
MAX_LEASE    = 60 s
DEFAULT_DURATION = 5 s when the envelope omits `parameters.duration`
```

When the overlay reports `state: "playing"` (the mount ack), the lease shrinks to `duration + 2 s` — once the alert has actually started, the budget is just "finish playing." When the overlay reports `"completed"` or `"failed"`, the lease is cleared and the next pending alert dispatches.

## Lease-timeout policy: advance immediately

If neither `playing`, `completed`, nor `failed` is reported before the lease expires, the queue marks the row `timed_out` and **dispatches the next pending alert immediately**. Common causes: no overlay connected, browser tab frozen, autoplay block with no error event surfaced.

This is a deliberate "keep the queue moving" choice. The alternative — pause the queue and wait for the operator — would leave a single stuck overlay holding up every subsequent alert across the application. Operators get an `ALERT_TIMED_OUT` webhook plus a `replayAlert(id)` button, which is the right escalation surface for a real failure.

## Status acks

Status acks arrive via the unified `widget.event` channel (see [Widget event channel](../services/widget-events.md)). The orchestrator's dispatcher routes them to `AlertQueueManager.handleStatus(applicationId, envelopeId, state, error?)`.

`handleStatus` ignores reports that are stale — for an envelope that's no longer in flight, or for a different application — without warning. Stale acks are a routine side effect of reconnects and lease expirations.

| Reported state | Effect |
|----------------|--------|
| `playing` | Lease timer is reset to `duration + 2 s`. Row updated to `playing`. |
| `completed` | Lease cleared. Row updated to `completed`. Next pending dispatches. |
| `failed` | Lease cleared. Row updated to `failed` with `error` populated. Next pending dispatches. |

## Operator controls

The api gateway exposes three RPCs that forward to streamware as NATS request/reply. The api never touches the queue directly; the queue manager stays single-owner.

| API method | NATS subject | Effect |
|------------|--------------|--------|
| `replayAlert(id)` | `widget.queue.replay` | Loads the original envelope from `alerts`, stamps a fresh envelope id, re-publishes to `ui.notify.alert`, and marks the source row `replayed`. |
| `skipCurrentAlert(applicationId?)` | `widget.queue.skip` | Marks the in-flight envelope `skipped`, clears the lease, and dispatches the next pending. No-op when nothing is in flight. |
| `clearAlertQueue(applicationId?)` | `widget.queue.clear` | Marks every pending envelope `skipped` (without touching the in-flight lease). Returns the count cleared. |

Both `skipCurrentAlert` and `clearAlertQueue` resolve `applicationId` to the api's default when the caller omits it.

## Webhook projection

Streamware never calls webhooks directly. Every `db.updateAlertLifecycle` write produces a `db.alert.updated.{applicationId}` outbox event; the api/ subscribes to `db.alert.updated.*` and projects the event to the registered callback URL with the appropriate type:

| `alert.status` after update | Webhook event |
|-----------------------------|----------------|
| `completed` | `ALERT_COMPLETED` |
| `failed` | `ALERT_FAILED` |
| `timed_out` | `ALERT_TIMED_OUT` |
| `skipped` | `ALERT_SKIPPED` |
| `replayed` | `ALERT_REPLAYED` |

`ALERT_RECORDED` fires from the corresponding `db.alert.created.*` outbox event. See `shared/clients/typescript/api/webhooks.ts` for the full event shapes.
