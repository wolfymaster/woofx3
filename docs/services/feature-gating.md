# Feature gating

A feature can ship in an engine release and still reach managed engines only as a rollout gets to them, or only on a plan. A self-hosted engine of the same release has it outright. Three systems share the work:

- the engine (this repo) enforces what an engine may do
- the dashboard (woofx3-ui, on Convex) decides it and signs it
- woofx3-maintenance, which provisions managed engines, installs the keys that tell an engine to listen

## Three questions, three mechanisms

A gated engine feature shows in the dashboard only when all three answers are yes. Keep them apart: a rollout flag used as a plan gate never gets removed, and a plan gate kept in the UI alone is not enforced.

| Question | Mechanism | Decided by | Enforced by | Lifetime |
|---|---|---|---|---|
| Can this engine build do X? | [Capability](./engine-capabilities.md) | The engine build | The engine | Permanent |
| May this engine do X? | [Entitlement](./engine-entitlements.md) | The dashboard, for managed engines only | The engine | As long as the plan or rollout lasts |
| Should this viewer see new UI Y yet? | Feature flag (woofx3-ui `docs/patterns/feature-flags.md`) | The dashboard | Convex and the browser | Temporary: deleted once Y is on for everyone |

Entitlements reuse capability ids, so there is one id space. Only capabilities listed as [gateable](./engine-capabilities.md#gateable-capabilities) can be withheld.

## Why the engine enforces entitlements

Hiding a feature in the dashboard does not stop anyone from using it. The dashboard hands each engine's API credentials to the browser, which calls the engine directly, so the owner of a managed engine can call any RPC it serves. The engine therefore checks a grant itself.

The grant is signed, not just stored. The owner can call `setEntitlementGrant` too, but without the dashboard's private key nothing they send verifies.

## How a grant reaches an engine

```
 woofx3-maintenance                 Convex (woofx3-ui)                    browser
 ENGINE_ENTITLEMENT_PUBLIC_KEYS     engineEntitlements: targeting         EngineFeatureGate
        |                           entitlementGrants: seq, renewAt              ^
        | WOOFX3_ENTITLEMENT_       ENTITLEMENT_SIGNING_KEY (private)            |
        | PUBLIC_KEYS,                     |                                     | capabilities,
        | WOOFX3_ENGINE_NAME               | setEntitlementGrant(token)          | withheld
        v                                  v                                     |
 +---------------------------------------------------------------------------------------+
 | managed engine: api verifies the grant, stores it in the entitlements.grant setting,  |
 | refuses GATED_METHODS whose capability is withheld, and reports withheld ids           |
 +---------------------------------------------------------------------------------------+
```

1. **Keys.** Maintenance sets `WOOFX3_ENTITLEMENT_PUBLIC_KEYS` and `WOOFX3_ENGINE_NAME` on customer engines. With keys set, an engine is governed. Preview engines get no keys: a preview dashboard may not sign grants.
2. **Targeting.** An operator sets a capability's targeting in Convex's `engineEntitlements` table. It has the same `off` / `on` / `rules` shape as a feature flag, and a `licenseFeature` rule ties it to a plan.
3. **Signing.** For each managed instance, Convex evaluates every targeting row and signs the granted ids into an Ed25519 JWS. The grant is addressed to `eng-<first 8 hex digits of the maintenance engine id>`, and its `seq` is higher than any grant before it.
4. **Delivery.** Convex calls `setEntitlementGrant(token)` with the instance's credentials:
    - when the engine registers
    - after any targeting change
    - daily
    - an hour after a failed push

    A grant lasts 7 days, so a week of failed pushes passes before the engine loses anything.
5. **Enforcement.** The engine verifies the grant, refuses a lower `seq`, and stores the token in the `entitlements.grant` engine setting. Until a valid grant arrives, every gateable capability is withheld. The route wrapper refuses an RPC in `GATED_METHODS` while its capability is withheld.
6. **Display.** `getEngineCapabilities()` reports withheld ids in `withheld`, and Convex labels each one: a `licenseFeature` rule makes it a plan, anything else a rollout. The dashboard's `EngineFeatureGate` shows a plan-withheld feature as not included in the plan and hides a rollout-withheld one.

A self-hosted engine has no keys. It ignores all of this, refuses `setEntitlementGrant`, and withholds nothing.

## Shipping a gated feature

1. Ship the feature with its capability id ([engine capabilities](./engine-capabilities.md#rules)).
2. In the same release or a later one, list the id as gateable and map its RPC methods in `GATED_METHODS`. Any service other than the api that serves the feature adds its own check. It reads the `entitlements.grant` setting through the db proxy and verifies it with the same keys; nothing does this yet, because nothing gateable runs outside the api.
3. Target the capability in Convex (`engineEntitlements:set`) before that release reaches managed engines. A governed engine withholds a newly gateable capability from the moment it runs the release, so engines without a grant for it lose it.
4. Granting an id ahead of the release is safe: an engine ignores ids it does not know, and the feature turns on when the engine is upgraded.

A feature that is only dashboard UI over RPCs every engine already serves cannot be enforced by the engine. Gate it with a feature flag, or in Convex.

## Where the code lives

| Piece | Repo | Location |
|---|---|---|
| Grant format and verification | woofx3 | `api/src/entitlement-grant.ts` |
| Withholding, `GATED_METHODS`, the stored grant | woofx3 | `api/src/entitlements.ts` |
| Gateable ids | woofx3 | `GATEABLE_ENGINE_CAPABILITIES` in `shared/clients/typescript/api/capabilities.ts` |
| Keys for customer engines | woofx3-maintenance | `src/engines/engine-env.ts` |
| Targeting, grant rows, renewal cron | woofx3-ui | `convex/engineEntitlements.ts`, `convex/crons.ts` |
| Signing and pushing | woofx3-ui | `convex/entitlementGrantActions.ts`, `convex/lib/entitlementSigning.ts` |
| Withheld state in the dashboard | woofx3-ui | `client/src/lib/engine-capabilities.ts`, `engine-feature-gate.tsx` |
| Feature flags | woofx3-ui | `convex/lib/featureFlags.ts`, `convex/featureFlags.ts`, `useFeatureFlag` |

## Not built yet

- **Billing.** Plans come from the account's `licenses`, which are not yet sold or changed by billing. A license change reaches engines at the next daily renewal, not at once.
- **Limits.** The grant format has a `limits` field, but nothing sets or enforces it.
- **Checks outside the api.** Barkloader and wooflow do not read grants yet.
