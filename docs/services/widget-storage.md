# Widget storage

A widget on stream shows a value the engine holds: a counter's number, a
timer's remaining seconds, whatever a module keeps. A widget reads its own
module's storage through `host.storage.get` and `host.storage.subscribe`, and
the scene manager answers both for widgets placed on a scene.

The value a resource instance holds lives at `state:<canonicalId>` in the owning
module's storage namespace, the convention resource kinds follow and the one the
dashboard reads through `getResourceValues`. The bundled `woofx3` module's
Counter widget is the first reader: it subscribes to `state:<canonicalId>` of
the counter chosen in its settings.

## Shape

Two paths, both ending at sceneManager, which is the only browser-reachable
process that holds a db-proxy client and a NATS connection.

```
read:       widget → bridge → overlay page → sceneManager → db-proxy (Storage.Get)
subscribe:  db-proxy ← module writes                        (module.storage.<module>.changed)
                                     ↘ NATS → sceneManager → SSE → overlay page → bridge → widget
```

### Reading

1. The widget subscribes to a key; the shim sends `storage.subscribe`.
2. The first time any widget on the page subscribes to that key, the page asks
   sceneManager: `GET /scene/{sceneId}/widget/{instanceId}/storage?key={key}`.
   Addressed by **placement**, not by module; see "Which module" below.
3. sceneManager finds the placement on the scene, reads
   `Storage.Get(applicationId, namespace = its module, key)`, and answers
   `{ value }`. From then on it pushes every change to that key to the scene.
4. The page keeps the value (`public/scene-manager/module-state.ts`) and sends
   it to every widget subscribed to the key through the bridge's
   `sendStorageChanged`. A later subscriber gets it at once, without a fetch.

`host.storage.get` is answered synchronously from what the page has already
loaded, and answers `null` for a key no widget on the page has subscribed to.
A widget that shows a value subscribes.

### Changes

1. sceneManager subscribes to `module.storage.*.changed`, the same wildcard the
   api's `StorageChangeEmitter` uses.
2. A change to a key some page of a scene asked for is pushed down that scene's
   SSE stream as a `module-state` frame, `{ moduleId, key, value }`. Nothing is
   pushed to a scene that did not ask for the key.
3. A pushed change wins over a fetch that was still in flight when it arrived.
4. When the stream reconnects to the same sceneManager, the page fetches every
   key it holds again: changes made while it was disconnected were pushed to
   nobody. A reconnect to a restarted sceneManager reloads the page, which asks
   afresh.

## Empty values

A resource instance nothing has written yet holds nothing, and a session-scoped
value cleared when a stream session ended arrives as a change with a null value
(see [Stream sessions](./stream-sessions.md)). Neither is really empty: a counter
reads as its starting value. A widget cannot know that value, because it sees
only its own settings, not the instance's.

So sceneManager answers an empty `state:<canonicalId>`, on read and on change
alike, with what the owning module reads it as: `emptyResourceState` in
`sceneManager/src/scene/module-state.ts`. That repeats a rule the module owns,
and must match it (`readState` in `modules/woofx3/functions/counter.js`). Only
the woofx3 counter has an empty reading today; any other empty key reads as
`null`.

## Which module

A widget declares its own `moduleId` in the `hello` handshake
(`widget-bridge.ts`), and nothing checks that claim. It must not be what scopes
a storage read, or a widget could name another module and read its values.

The page already has the truth from the server: the scene record carries each
placement's module. So:

- the page keys what it holds by the placement's module from the scene record,
  and sends a value to a widget under whichever module the widget named;
- sceneManager reads through the placement, and takes the module from the scene
  it loaded, never from the request.

Storage stays scoped by application too: the application comes from the
overlay's own session, never from the request.

## Widgets do not write

The protocol has no `storage.set`. A widget is a display; changing a value is an
action the engine performs, requested through a module function
([engine integrity](./engine-integrity.md)). A widget that wants to change
something reports a widget event, which is the existing channel for that
([Widget event channel](./widget-events.md)).

## Not covered

- **Alert layout widgets.** A widget playing in an alert is not a placement, so
  it has nothing to read through: `storage.get` answers `null` and subscriptions
  never fire (`alert-widget.ts`).
- **More than one application per engine.** `module.storage.changed` carries no
  application, because one barkloader serves one application. A change is
  pushed to every connected scene that asked for the key.

## What this rules out

- **Browser → db-proxy directly.** The db proxy is not browser-reachable and has
  no per-overlay authorization; the overlay token boundary is the point.
- **Pushing every storage change to every overlay.** Unbounded fan-out, and it
  would hand each overlay every module's values.
- **Polling from the widget.** A counter that ticks a second behind chat looks
  broken, and one poll per widget per second scales with the scene.
