# Browser pairing

A web app that talks to a local or self-hosted engine directly needs its own client id and secret, and no secret may be baked into a bundle anyone can download. Pairing gives each browser its own credentials, approved by a person who is already using the engine. The flow is the device-code shape of RFC 8628: the browser shows a code, and the operator types it somewhere trusted.

Pairing exists only on an engine whose deployment sets `WOOFX3_HOSTING` to `local` or `self`. Such an engine advertises the `clients.pairing` capability, and its gateway's `ping()` answers `{ status: "ok", pairing: "available" }`. A managed engine, or one with `WOOFX3_HOSTING` unset, leaves `pairing` out of `ping()` and answers every pairing call with `not_available`. The types and helpers are in `@woofx3/api/pairing` (`shared/clients/typescript/api/pairing.ts`); the engine side is `PairingRegistry` in `api/src/pairing.ts`.

## The flow

1. **The browser starts.** It makes a verifier with `newPairingVerifier()` (32 random bytes, base64url) and keeps it in memory only. It calls `startPairing({ description, verifierHash })` on the unauthenticated gateway, where `verifierHash` is `pairingVerifierHash(verifier)` (PKCE's S256). The engine takes the origin from the request's `Origin` header, never from a parameter, and answers with a pairing id, a user code, an expiry and a poll interval.
2. **The browser shows the code**, formatted `ABCD-EFGH` with `formatPairingCode`, and polls `claimPairing({ pairingId, verifier })`.
3. **The operator approves.** On a surface that is already a client of the engine (the desktop window, or a browser paired earlier), they type the code. `lookupPairing({ userCode })` returns the pairing with the origin and description to show them; they check the origin and call `decidePairing({ pairingId, decision: "approve" })`, or `"deny"`.
4. **The browser collects its credentials.** Its next `claimPairing` creates the client (`kind = paired`, bound to the origin) through db-proxy and answers `{ status: "approved", credentials }`. The credentials are given once: the pairing is gone after that.

`claimPairing` answers:

| Status | Meaning |
|---|---|
| `pending` | Not decided yet. Poll again after the interval. |
| `slow_down` | Polled too soon. Wait the returned `pollIntervalMs`, which grows by 5 seconds each time. |
| `approved` | Here are the credentials. |
| `denied` | The operator refused. |
| `expired` | Nothing was decided, or claimed, before the pairing expired. Start a new one. |
| `not_found` | No such pairing for this browser: also the answer to a wrong verifier or origin. |
| `failed` | The engine could not create the client. Retry when `retryable`. |

The browser can give up with `cancelPairing({ pairingId, verifier })`. An approver can list every pairing waiting for a decision or a claim with `listPendingPairings()`.

The user code is a correlation id, not a credential. Approving needs a client of the engine, and collecting the credentials needs the verifier, which never leaves the browser. A code read off a stream or a screenshot lets nobody in. The engine logs each started pairing at info level, with its origin, description and user code, so an operator without a screen can match a code to its browser. The `client.pairing.started` event tells every client that a browser is waiting, with its origin, description and expiry, but never its code: the operator reads the code off the browser itself.

## Which origins may pair

- The request must carry an `Origin`. A call without one is not from a browser.
- `null` is refused: opaque origins cannot be told apart.
- A page on the engine's own computer (`localhost`, `127.0.0.1` or `[::1]`, over http or https) may pair.
- A page anywhere else may pair only over https, and only once the operator has listed its origin in `WOOFX3_ALLOWED_ORIGINS`. With no list set, the engine refuses every such origin, and the refusal names the setting. A hosted web app therefore cannot pair with an engine unless that engine's operator chose to let it.
- Plain http from another computer is refused even when listed: it would carry the secret across the network in clear.
- The desktop app's own window (`tauri://localhost`, `tauri.localhost`) is refused: the desktop shell registers with the registration token instead.

The request guard runs first. With `WOOFX3_ALLOWED_ORIGINS` set, only listed origins reach `startPairing` at all; the desktop app sets it to the loopback origins and its own window, so the hosted web app cannot reach a desktop engine. Pairing never admits more than the list does.

A paired client stays bound to its origin. `authenticate` refuses its credentials from any other origin, or from a request with no `Origin`, with the same refusal as wrong credentials. That stops the secret being used from another web page, because a browser always sends the page's real `Origin`. It is not a defence against a stolen secret: any client outside a browser, on any machine that can reach the engine, can send the paired origin. Treat a paired secret like any other client secret, and delete the client if it is exposed.

The claim must come from the origin that started the pairing. Calls naming a pairing from any other origin answer `not_found` and change nothing, so a pairing id seen in the log or the event cannot be used to end someone else's pairing.

## Limits

Each limit bounds what an unauthenticated caller can make the engine hold or do. They are `DEFAULT_PAIRING_CONFIG` in `api/src/pairing-config.ts`.

| Limit | Value | Why |
|---|---|---|
| Expiry | 10 minutes | Long enough to walk to another machine. |
| Poll interval | 5 seconds | RFC 8628's default. |
| Pairings waiting at once | 5 | The bound on memory and on approver noise. |
| Pairings waiting from one origin | 2 | So one origin cannot fill every slot. |
| Starts per origin | 6 a minute | A sliding window. |
| Starts from every origin together | 20 a minute | A non-browser caller can forge `Origin`. |
| Wrong claims before a pairing ends | 3 | A wrong verifier on `claimPairing` or `cancelPairing` from the pairing's own origin. |
| Denials remembered | 20 | So a denied browser learns it was denied; the oldest is forgotten first, and its browser then sees `not_found`. |

A refused start says why (`rate_limited` with `retryAfterMs`, or `too_many_pending`), and the engine logs each refusal. Denying a pairing frees its slot at once, so an operator can clear a flood of unwanted requests without waiting for them to expire.

## Where pairings live

Pending pairings live in the api's memory, like Twitch device logins. A pairing is a request waiting a few minutes for a person, not a record: the client it may become is created through db-proxy, which owns clients, only when the browser claims it. Keeping pairings out of the database means a verifier hash and an unapproved request never reach disk, and nothing needs cleaning up. An api restart forgets every pending pairing; the browser, which is polling, sees `not_found` and starts again. Expiry is checked whenever a pairing is touched, and the limits bound how many there can be, so no timer runs.

The client row is created at claim time, not at approval. The pairing is marked as being claimed in the same turn as the check, so two claims at once cannot create two clients. If db-proxy fails, the pairing goes back to approved and the claim answers `failed` with a generic message (the detail goes to the engine's log); the next poll retries. An approval that is never claimed expires without creating anything. If the credentials are created but the answer never reaches the browser, the client exists but was never used; it can be deleted like any other client.

## Running a self-hosted engine with pairing

- Set `WOOFX3_HOSTING=self`.
- Set `WOOFX3_ALLOWED_ORIGINS` to the origins of the web app that will pair, and `WOOFX3_ALLOWED_HOSTS` to the engine's own host names. Without the origin list, only a browser on the engine's own computer can pair.
- Serve the engine and the web app over https, unless both are on the same machine.
- Every paired browser can approve the next one; there are no roles.

### Approving the first browser

The first browser needs an approver that is already a client. On the desktop engine that is the desktop window. A self-hosted engine may have no such client yet, and the engine has no command of its own for approving from the server. Until it does, approve with a short script that registers its own client with the engine's registration token, then decides the pairing by the code the browser shows:

```ts
import type { Woofx3EngineApi } from "@woofx3/api";
import type { ApiGatewayContract } from "@woofx3/api/rpc";
import { newWebSocketRpcSession } from "capnweb";

const gateway = newWebSocketRpcSession<ApiGatewayContract>("ws://127.0.0.1:5050/api");
const { clientId, clientSecret } = await gateway.registerClient("pairing approver", {
  registrationToken: process.env.WOOFX3_REGISTRATION_TOKEN,
});
const api = gateway.authenticate(clientId, clientSecret) as unknown as Woofx3EngineApi;

const found = await api.lookupPairing({ userCode: process.argv[2] });
if (!found.ok) {
  throw new Error(`no pairing for that code: ${found.code}`);
}
console.log(`${found.pairing.description} at ${found.pairing.origin}`);
// Check the origin is the web app you expect before approving.
console.log(await api.decidePairing({ pairingId: found.pairing.pairingId, decision: "approve" }));
```

Run it on the engine's host, with the code the browser shows (`bun approve.ts ABCD-EFGH`). The registered client stays; delete it afterwards with `deleteClient` if you no longer need it.
