# Engine entitlements

A capability says what an engine build *can* do. An entitlement says what one engine *may* do. A self-hosted engine may do everything its build can. A managed engine, provisioned by the woofx3 maintenance API, uses a gateable feature only when the dashboard has granted it, which lets a feature ship in an engine release while it rolls out, or stays on a plan, across managed engines.

[Feature gating](./feature-gating.md) shows how this fits with the dashboard's signer and its UI flags. The engine enforces this itself. A UI that hides a feature is not enough: the dashboard holds each engine's API credentials, and so does every browser session that talks to the engine.

## Governed and ungoverned engines

`WOOFX3_ENTITLEMENT_PUBLIC_KEYS` decides which kind an engine is.

| Setting | Engine | Gateable capabilities |
|---|---|---|
| Unset | Ungoverned: every self-hosted engine | Always available |
| Set | Governed: a managed engine | Available only while an unexpired grant lists them |

The value is a comma-separated list of `kid:key` pairs, each key a raw 32-byte Ed25519 public key in base64url. More than one key lets the signer rotate keys without a window in which grants fail to verify. A governed engine also needs `WOOFX3_ENGINE_NAME`, because a grant names the engine it is for; the api refuses to start with keys but no name.

Capabilities that are not gateable are never withheld. `GATEABLE_ENGINE_CAPABILITIES` in `shared/clients/typescript/api/capabilities.ts` lists the gateable ones.

## The grant

A grant is a compact JWS: `base64url(header).base64url(payload).base64url(signature)`, with an Ed25519 signature over the first two parts.

```json
{ "alg": "EdDSA", "kid": "k1", "typ": "woofx3-entitlements+jwt" }
```

| Payload field | Meaning |
|---|---|
| `aud` | The engine's `WOOFX3_ENGINE_NAME`. A grant for another engine is refused. |
| `iat` | Issued at, seconds since the epoch. |
| `exp` | Expires at, seconds since the epoch. An expired grant grants nothing. |
| `seq` | Increases with every grant the signer issues for this engine. |
| `grants` | Capability ids the engine may use. Ids this build does not know are ignored, so a grant can name a feature before the engine is upgraded to have it. |
| `limits` | Optional numeric limits by name. |

The dashboard signs grants with a private key only it holds and sends them with `setEntitlementGrant(token)`. The engine:

- refuses the call when it is ungoverned
- refuses a grant that does not verify, is addressed to another engine, or has expired
- refuses a grant whose `seq` is lower than the held grant's, so a grant from before a downgrade cannot be replayed; re-sending the held grant is accepted
- stores the grant in the `entitlements.grant` engine setting, so a restart keeps it

A governed engine with no grant, an expired grant, or a stored grant that no longer verifies (its key was rotated out) withholds every gateable capability until the next grant arrives. Expiry is how a missed push is bounded: the signer renews grants well before `exp`.

## What clients see

`getEngineCapabilities()` leaves withheld ids out of `capabilities` and lists them in `withheld`:

```ts
{ schema: 1, capabilities: ["analytics.sessions", ...], withheld: ["obs.control"] }
```

A client that predates entitlements reads only `capabilities` and hides a withheld feature as if the engine lacked it. A newer client can tell "update your engine" from "not enabled for this engine". An engine that predates entitlements sends no `withheld`.

## Enforcement

- **RPC methods:** `GATED_METHODS` in `api/src/entitlements.ts` maps a method to its gateable capability. The route wrapper in `api/src/routes/index.ts` refuses a gated method while its capability is withheld, so no route can forget the check. `getEngineCapabilities` and `setEntitlementGrant` are never gated.
- **Other services:** a gateable feature reachable without the api, such as a manifest permission checked at install or a workflow action, needs its own check where it runs. That service reads the `entitlements.grant` setting through the db proxy and verifies it with the same keys.
- **Not enforceable here:** a feature that is only UI over RPCs every engine already serves. Gate that in the dashboard.

## Adding a gateable capability

1. Add the id to `GATEABLE_ENGINE_CAPABILITIES`, and list it under [Gateable capabilities](./engine-capabilities.md#gateable-capabilities).
2. Map each of its RPC methods in `GATED_METHODS`, and add a check in any other service that serves it.
3. Make sure the dashboard grants it to the managed engines that should have it before the release that gates it reaches them. A governed engine withholds a newly gateable capability from the moment it runs the release that gates it.
