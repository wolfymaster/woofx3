# Widget storage

::: warning Design, not built
Nothing below exists yet. `onStorageGet` in the overlay returns `null` and
subscriptions never fire, so a widget that reads module storage shows nothing.
This is the design for closing that.
:::

A widget on stream shows a value the engine holds: a counter's number, a
timer's remaining seconds, whatever a module keeps. The widget protocol has
carried the messages for this since P1 — `storage.get`, `storage.subscribe`,
`storage.value`, `storage.changed` — but nothing on the overlay side answers
them.

## What exists today

| Piece | State |
|---|---|
| Widget → host messages (`storage.get` / `subscribe` / `unsubscribe`) | Built, in `shared/clients/typescript/module-sdk/src/widget-protocol.ts` |
| `host.storage.get` / `subscribe` in the widget shim | Built, in `widget-host-shim.ts` |
| Bridge plumbing, including `sendStorageChanged` | Built, in `sceneManager/public/scene-manager/widget-bridge.ts` |
| The overlay's answers (`onStorageGet`) | **Returns `null`** — `scene-manager/index.ts`, `alert-widget.ts` |
| A sceneManager subscription to `module.storage.*.changed` | **Absent** — deliberately skipped in `nats-subscriptions.ts` |
| A read path from the browser to module storage | **Absent** |

The value a widget wants lives at `state:<canonicalId>` in the owning module's
storage namespace — the convention resource kinds follow, and the one the
dashboard already reads through `getResourceValues`.

## Shape of the fix

Two paths, both terminating at sceneManager, which is the only browser-reachable
process that already holds a db-proxy client and a NATS connection.

```
read:       widget → bridge → overlay page → sceneManager → db-proxy (Storage.Get)
subscribe:  db-proxy ← module writes                        (module.storage.<module>.changed)
                                     ↘ NATS → sceneManager → SSE → overlay page → bridge → widget
```

### Reading

1. The widget calls `host.storage.get(key)`; the shim sends `storage.get` with a
   correlation id.
2. The overlay page asks sceneManager: `GET /widget-storage/{instanceId}/{key}`.
   The **instance id**, not a module id — see "Which module" below.
3. sceneManager resolves the widget instance to its module, reads
   `Storage.Get(applicationId, namespace = module, key)`, and answers.
4. The page replies `storage.value` with the same correlation id.

The bridge's `onStorageGet` callback becomes async. The protocol is already
correlated, so nothing about the message shape changes.

### Subscribing

1. sceneManager subscribes to `module.storage.*.changed`, the same wildcard the
   api's `StorageChangeEmitter` uses.
2. On a change it pushes one frame down the overlay's existing SSE stream:
   `{ module, key, value, occurredAt }`.
3. The page routes it to every bridge whose widget belongs to that module and
   holds a subscription for that key, and calls the bridge's existing
   `sendStorageChanged`.
4. On `storage.subscribe`, the page performs a read first and delivers the
   current value immediately, so a widget renders without waiting for the next
   change.

A value cleared at the end of a stream session arrives here as a change with a
null value, because the session resolver announces every key it clears
(see [Stream sessions](./stream-sessions.md)). Widgets showing a session value
reset on their own; a null reads as "nothing stored", which a counter widget
renders as its starting value.

## Which module — the one real constraint

A widget declares its own `moduleId` in the `hello` handshake
(`widget-bridge.ts`), and the bridge believes it. That is fine for what it does
today, and **must not** be what scopes a storage read: a widget could name
another module and read its values.

The overlay already knows the truth from the server. The frame assembler builds
each widget instance from a scene record that carries its `moduleId`, so:

- the page addresses reads by **widget instance id**, and sceneManager maps that
  to a module from the scene it already loaded;
- change deliveries are filtered by the same server-side mapping;
- the `hello` module id keeps its current role (identifying the frame) and gains
  no authority.

Storage stays scoped by application too: the application comes from the
overlay's own token, never from the request.

## Widgets do not write

The protocol has no `storage.set`, and this design does not add one. A widget is
a display; changing a value is an action the engine performs, requested through
a module function ([engine integrity](./engine-integrity.md)). A widget that
wants to change something reports a widget event, which is the existing channel
for that ([Widget event channel](./widget-events.md)).

## What this rules out

- **Browser → db-proxy directly.** The db proxy is not browser-reachable and has
  no per-overlay authorization; the overlay token boundary is the point.
- **Pushing every storage change to every overlay.** Unbounded fan-out, and it
  would hand each overlay every module's values.
- **Polling from the widget.** A counter that ticks a second behind chat looks
  broken, and one poll per widget per second scales with the scene.

## Work items

1. `sceneManager`: a storage read route, keyed by widget instance id, resolving
   the module server-side and calling `Storage.Get` with the module namespace.
2. `sceneManager`: subscribe to `module.storage.*.changed`, fan out to the
   overlay over SSE, filtered by the scene's own widget→module mapping.
3. `scene-manager` (browser): async `onStorageGet`, a subscription registry keyed
   by (module, key) with refcounts, a read-through on subscribe, and a re-read of
   every open subscription after an SSE reconnect — values change while a stream
   is disconnected.
4. `alert-widget.ts`: the same callbacks, so an alert widget can read storage.
5. A counter widget in the bundled `woofx3` module: `resource_ref(kind=counter)`
   plus a label template, subscribing to `state:<canonicalId>`.

## Testing

- A widget reading a key gets the module's value, and reading a key belonging to
  another module gets nothing, even when the widget claims that module in
  `hello`.
- A module write reaches an open subscription, and only the widgets subscribed to
  that key.
- Subscribing delivers the current value without waiting for a change.
- A cleared session value arrives as null and the widget falls back to its
  starting value.
- An SSE reconnect re-reads open subscriptions.
