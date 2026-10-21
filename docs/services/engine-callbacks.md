# Engine callbacks: webhooks and the event stream

The engine tells its clients when its state changes (a workflow saved, a scene deleted, a module installed, an alert played), and sometimes needs a client to answer a question (a fresh Twitch token, a relay credential, a place in the shoutout queue). Both travel as CloudEvents 1.0 envelopes defined in `shared/clients/typescript/api/webhooks.ts`, over one of two transports:

- **Webhooks**: an HTTP POST to the `callbackUrl` a client gave when it registered (`registerClient`). This is how a cloud dashboard hears from its engine, whether or not anyone has the dashboard open.
- **The event stream**: a push over the client's own capnweb WebSocket session, after it calls `subscribeEngineEvents`. This is how a client with no callback URL, such as the desktop app driving a local engine, hears from its engine. Engines with the `engine.eventStream` capability serve it.

Both transports carry the same envelopes. The api builds each envelope once, in `WebhookClient` (`api/src/webhook-client.ts`), and hands it to both: the HTTP delivery in that file, and `EngineEventStream` (`api/src/engine-event-stream.ts`) for the stream. So a handler written for webhook bodies works unchanged on stream frames.

## Events

An event is a `CallbackEnvelope` whose `type` is an `EngineEventType` (`workflow.*`, `workflow.run.*`, `scene.*`, `command.*`, `group.*`, `alert.*`, `module.*`, `engine.response.received` and the rest). Most events go to every client. A few report on one client's call and go only to that client: the results of a module install it started (`module.installed`, `module.install_failed`, and the triggers that install registered).

A client gets each event on every transport it has: a POST to its callback URL, if it registered one, and a push on each of its event stream subscriptions. A client with both receives every event twice, with the same envelope `id`. That is deliberate. The two transports serve different readers: the webhook reaches a backend that keeps state whether or not a browser is open, and a subscription reaches one open session that wants to show changes live. Letting a subscription replace the webhook would make the backend's state depend on whether a tab happened to be open, and would lose events whenever it closed. Consumers are idempotent on the envelope `id` already, as webhook retries require.

## Requests

A request is a `RequestEnvelope` whose `type` is an `EngineRequestType`:

| Request | Asked when | Answer |
|---|---|---|
| `twitch.token.requested` | A Twitch token the client sent is about to expire, or Twitch refused it | `TwitchTokenRequestedResponse` |
| `relay.credential.requested` | sceneManager needs a bridge credential for the companion relay; see [Local endpoints](./local-endpoints.md#the-bridge-credential) | `RelayCredentialRequestedResponse` |
| `shoutout.enqueue.requested` | A workflow or chat command asked for a shoutout | `ShoutoutEnqueueRequestedResponse` |

Each request goes to one client, chosen the same way whatever the transport:

- **Twitch token:** the client that sent the token (`setTwitchToken`), whose id is stored with it.
- **Shoutout:** the client the linked Twitch account came from, for the same reason: it holds the Twitch link and its shoutout queue.
- **Relay credential:** the client that set the relay configuration (`setRelayConfig`) while it can still be reached; otherwise the first reachable client, so a client that registered again under a new id is asked instead of the old one forever.

Then the transport is chosen for that client:

1. **It registered a callback URL:** the request is POSTed there, and the answer is the JSON response body. A non-2xx status refuses. This holds even while the client also has an event stream subscription.
2. **It has no callback URL but a live subscription:** the request is pushed on its newest subscription as a `request` frame. The client answers with `answerEngineRequest(envelope.id, answer)`, where `answer` is `{ ok: true, body }` (the body a callback URL would have answered with) or `{ ok: false, error }` to refuse.
3. **Neither:** the request fails at once with "no registered dashboard", as it would with no client at all, and the caller handles that as it always has (a token renewal fails, a shoutout reports no queue).

The engine waits 5 seconds for an answer on either transport. Over the stream, a request also fails at once when the subscription drops before it is answered, or when the frame is dropped unsent because the client fell behind. A request whose caller has already stopped waiting is not pushed at all. A request is never retried. `answerEngineRequest` rejects a request id that is not waiting for the calling client: one that timed out, was answered already, or was sent to someone else.

## Subscribing

```ts
subscribeEngineEvents(callback: EngineEventSubscriber, options?: { types?: EngineEventType[] }): Promise<void>
answerEngineRequest(requestId: string, answer: EngineRequestAnswer): Promise<void>
```

The types are in `shared/clients/typescript/api/engine-events.ts`. The callback is a capnweb stub whose `onEngineEvent(frame)` receives an `EngineEventFrame`: `{ kind: "event", envelope, seq }` or `{ kind: "request", envelope, seq }`. With `types`, only those event types are pushed; a type the engine does not know fails the call, naming it, rather than matching nothing. Requests are pushed whatever `types` says, because a client with a subscription is the one the engine asks.

A subscription belongs to the session and the client that made it. Calling again on the same session replaces it. It ends when the session's socket closes, when the client is deleted, or when the engine shuts down, and the engine releases the callback stub then. Requests waiting on it fail at once. A client may hold subscriptions on several sessions at once (two windows, say): every one of them gets the client's events, and requests go to the newest.

## Delivery guarantees

Delivery on the stream is **not gapless**. It is at most once, in order per subscription, with no replay:

- A client misses whatever happened before it subscribed and while it was disconnected. It reads the state it shows after subscribing, and again after every reconnect.
- Each subscription has its own queue, and the engine waits for each `onEngineEvent` call to return before pushing the next frame. Publishing never waits on a subscriber, and a slow subscriber holds up only itself. Its queue holds 256 frames; past that the oldest is dropped. `seq` starts at 1 and rises by one for every frame due to the subscription, delivered or not, so a jump of more than one tells the client it missed frames and should read its state again.
- An `onEngineEvent` call that rejects, or that has not settled within 10 seconds, ends the subscription, and the engine logs why. A handler catches its own errors, and a client whose subscription ends this way reconnects and subscribes again.

Webhook delivery is also at most once: an event POST is retried once after a second on a network error or 5xx, and then dropped.
