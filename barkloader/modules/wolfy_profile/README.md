# wolfy_profile

Example module packaging workflow definitions that used to be pushed via `woofx3/wooflow/workflows/*.sh` (POST to `/v1/workflow-definitions`).

This module declares **only workflows** — no triggers, actions, or functions of its own. Every reference is a cross-module canonical id:

- **`twitch_platform`** _(install first)_ — provides the EventSub-aligned trigger declarations (`twitch.channel.follow`, `twitch.channel.subscribe`, etc.).
- **`builtin:action:alert`** — the workflow engine's built-in alert handler. Always available; nothing to install.

The legacy `update_timer` step on the follow workflow has been dropped pending a built-in (or `slobs` module) that exposes a timer action; the rest of the alert behavior is preserved.

## Source mapping

| Workflow `id` | Source script |
|---------------|----------------|
| `follow-workflow` | `wooflow/workflows/follow_workflow.sh` |
| `subscription-workflow` | `wooflow/workflows/subscription_workflow.sh` |
| `bits-workflow` | `wooflow/workflows/bits_workflow.sh` |
| `gifted-subscription-workflow` | `wooflow/workflows/giftedSubscription_workflow.sh` |

Scripts `simple_workflow.sh` and `add_workflow.sh` still live under `wooflow/workflows/` but are not included in this manifest.

## Workflow triggers

Every `workflow.trigger` field is a full canonical id (`{moduleId}:trigger:{manifest_id}`) pointing at the `twitch_platform` module's trigger declarations:

| Workflow | `trigger` (canonical id) | Underlying NATS subject |
|----------|--------------------------|-------------------------|
| `follow-workflow` | `twitch_platform:trigger:twitch.channel.follow` | `twitch.channel.follow` |
| `subscription-workflow` | `twitch_platform:trigger:twitch.channel.subscribe` | `twitch.channel.subscribe` |
| `bits-workflow` | `twitch_platform:trigger:twitch.channel.cheer` | `twitch.channel.cheer` |
| `gifted-subscription-workflow` | `twitch_platform:trigger:twitch.channel.subscription.gift` | `twitch.channel.subscription.gift` |

The NATS subject the engine subscribes to lives on the trigger row (`triggers.event`) — install resolves the workflow's `trigger` canonical id against that row at registration time. The workflow definition itself doesn't carry the subject.

When simulating via API, pass the EventSub subscription type only (e.g. `channel.cheer`); the bus publishes `type` `twitch.channel.cheer`.

## Trigger conditions (TODO)

The legacy API stored event filters on the trigger. Re-apply these when the manifest gains support for trigger conditions (`ManifestWorkflow.trigger` is currently a string-only reference; condition wiring is tracked separately):

| Workflow | Condition |
|----------|-----------|
| `bits-workflow` | `data.amount >= 1` |
| `user-generated-workflow-1` _(script-only, not packaged here)_ | `data.amount >= 500` |
| `bits-subs-celebration` _(script-only, not packaged here)_ | `data.amount >= 100` |

Other packaged workflows have no conditions.

## Step shape

Every step in this manifest follows the workflow engine's [`TaskDefinition`](../../../../docs/workflow/schema.md#taskdefinition) shape:

```json
{
  "id": "alert",
  "type": "action",
  "action": "slobs:action:media_alert",
  "parameters": {
    "audioUrl": "...",
    "mediaUrl": "...",
    "text": "..."
  }
}
```

Notes on the migration from the legacy script format:

- Old step-level `params` is now `parameters` to match the engine's `TaskDefinition`.
- Old `_stepId` field inside params became the step's top-level `id`.
- Old `_stepType` field (`"action"` / `"wait"`) became the step's top-level `type`. Today every step in this manifest is `type: "action"`; `wait` and other types from the legacy scripts will surface here once the manifest gains support for them.
- Old `_stepName` had no equivalent in the engine's task shape and was dropped.
- The legacy `action` string (e.g. `"media_alert"`) is now a full canonical id (`"slobs:action:media_alert"`) referencing an action declared in another module. Action references must be either a manifest-local id (resolved against this manifest's `actions[]`) or a full canonical id with `:` separators — bare strings without canonical form will fail validation.
- `dependsOn`, `exports`, and other engine task fields can be added at the step's top level when needed; they're no longer hidden inside `params`.

## Layout

Unpacked directory for local inspection or tooling. Zip this folder (with `module.json` at the archive root) to install through barkloader's upload path. Install order matters: bring up `twitch_platform` before `wolfy_profile`, and bring up the `slobs` action provider before the workflows can run.
