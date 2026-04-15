# wolfy_profile

Example module packaging workflow definitions that used to be pushed via `woofx3/wooflow/workflows/*.sh` (POST to `/v1/workflow-definitions`).

Twitch triggers are **not** declared here; install **`twitch_platform`** so the EventSub-aligned trigger ids exist in the system.

## Source mapping

| Workflow `id` | Source script |
|---------------|----------------|
| `follow-workflow` | `wooflow/workflows/follow_workflow.sh` |
| `subscription-workflow` | `wooflow/workflows/subscription_workflow.sh` |
| `bits-workflow` | `wooflow/workflows/bits_workflow.sh` |
| `gifted-subscription-workflow` | `wooflow/workflows/giftedSubscription_workflow.sh |

Scripts `simple_workflow.sh` and `add_workflow.sh` still live under `wooflow/workflows/` but are not included in this manifest.

## Workflow triggers (EventSub-shaped)

| Workflow | Trigger id | Notes |
|----------|------------|--------|
| `follow-workflow` | `twitch.channel.follow` | |
| `subscription-workflow` | `twitch.channel.subscribe` | |
| `bits-workflow` | `twitch.channel.cheer` | Legacy API used event `bits`. |
| `gifted-subscription-workflow` | `twitch.channel.subscription.gift` | Replaces legacy id `gifited_subscription`. |

When simulating via API, pass the subscription type suffix only (e.g. `channel.cheer`); the bus publishes `type` `twitch.channel.cheer`.

## Legacy trigger conditions (engine / UI)

The old API stored **event filters on the trigger**. Re-apply these when wiring the engine:

| Workflow | Legacy trigger `event` | Legacy `condition` |
|----------|-------------------------|---------------------|
| `bits-workflow` | `bits` | `{ "amount": { "gte": 1 } }` |
| `user-generated-workflow-1` (script only) | `bits` | `{ "amount": { "gte": 500 } }` |
| `bits-subs-celebration` (script only) | `bits` | `{ "amount": { "gte": 100 } }` |

Other packaged workflows used the event only (no `condition` object).

## Step shape

- Old `parameters` → manifest `params`.
- Old `type: "action"` / `"wait"` is reflected in `params._stepType` and the manifest `action` string (`media_alert`, `update_timer`, `wait`, etc.).
- `dependsOn`, `exports`, and `waitFor` are preserved inside `params` where they appeared on the legacy step.

## Layout

Unpacked directory for local inspection or tooling; zip this folder (with `module.json` at the archive root) to install through barkloader’s upload path.
