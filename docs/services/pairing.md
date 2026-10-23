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
- The scheme must be `https:`, or `http:` on `localhost`, `127.0.0.1` or `[::1]`. A plain-http origin on any other host would carry the secret across the network in clear.
- The desktop app's own window (`tauri://localhost`, `tauri.localhost`) is refused: the desktop shell registers with the registration token instead.

The request guard runs first. With `WOOFX3_ALLOWED_ORIGINS` set, only listed origins reach `startPairing` at all, and pairing narrows that list further, never widens it. With the list unset, the operator's approval, which shows the origin, is the only origin check.

A paired client stays bound to its origin. `authenticate` refuses its credentials from any other origin, or from a request with no `Origin`, with the same refusal as wrong credentials. A stolen secret therefore does not work from another web page on the same machine. It does not stop a native process that forges headers; such a process already runs as the user and could read the registration token file.

The claim must come from the origin that started the pairing.

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
| Wrong claims before a pairing ends | 3 | A wrong verifier or origin on `claimPairing` or `cancelPairing`. |

A refused start says why (`rate_limited` with `retryAfterMs`, or `too_many_pending`), and the engine logs each refusal.

## Where pairings live

Pending pairings live in the api's memory, like Twitch device logins. A pairing is a request waiting a few minutes for a person, not a record: the client it may become is created through db-proxy, which owns clients, only when the browser claims it. Keeping pairings out of the database means a verifier hash and an unapproved request never reach disk, and nothing needs cleaning up. An api restart forgets every pending pairing; the browser, which is polling, sees `not_found` and starts again. Expiry is checked whenever a pairing is touched, and the limits bound how many there can be, so no timer runs.

The client row is created at claim time, not at approval. The pairing is marked as being claimed in the same turn as the check, so two claims at once cannot create two clients. If db-proxy fails, the pairing goes back to approved and the claim answers `failed`; the next poll retries. An approval that is never claimed expires without creating anything. If the credentials are created but the answer never reaches the browser, the client exists but was never used; it can be deleted like any other client.

## Running a self-hosted engine with pairing

- Set `WOOFX3_HOSTING=self`.
- Set `WOOFX3_ALLOWED_ORIGINS` to the origins of the web app that will pair, and `WOOFX3_ALLOWED_HOSTS` to the engine's own host names.
- Serve the engine and the web app over https, unless both are on the same machine.
- Approve the first browser from a client you already have. Every paired browser can approve the next one; there are no roles.
