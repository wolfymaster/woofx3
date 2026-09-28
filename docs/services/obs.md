# OBS control

Workflows change OBS through three engine-native actions: `obs.switch_scene`,
`obs.set_source_visibility` and `obs.set_input_mute` (parameters in
[Task types](../workflow/tasks.md#obs-switch-scene-obs-set-source-visibility-obs-set-input-mute)).
The workflow engine never talks to OBS itself. The scene manager holds the one
OBS WebSocket connection, and the engine asks it to act over NATS.

```
workflow step ──request──▶ engine.obs.command ──▶ sceneManager ──obs-websocket v5──▶ OBS
              ◀──{ ok, error? }────────────────────┘
```

## Connecting OBS

OBS 28 and later ship the WebSocket server the scene manager speaks (protocol
v5).

1. In OBS, open **Tools → WebSocket Server Settings**, tick **Enable
   WebSocket server**, and note the port (4455 by default).
2. Leave **Enable Authentication** on and copy the password with **Show
   Connect Info**.
3. Give the scene manager the address and password:

| Variable | Default | Meaning |
|---|---|---|
| `WOOFX3_OBS_HOST` | `127.0.0.1` | Host running OBS |
| `WOOFX3_OBS_PORT` | `4455` | OBS WebSocket server port |
| `WOOFX3_OBS_RPC_TOKEN` | none | OBS WebSocket server password |

The scene manager connects once, at startup, and carries on without OBS if the
connection fails, logging `OBS connection failed; continuing without OBS
control`. Start OBS before the scene manager, or restart the scene manager
after starting OBS. Until it is connected, every `obs.*` step fails with `OBS
is not connected to the scene manager`.

Names are OBS's own: a step names a scene, source or audio input exactly as it
appears in OBS, case included. Renaming a scene in OBS breaks the steps that
name it, and they fail saying which scene is missing.

## `engine.obs.command`

A NATS request/reply subject. The request is a CloudEvent of type
`engine.obs.command` whose `data` is one command
(`ObsControlCommand` in `shared/common/typescript/cloudevents/Obs/commands.ts`):

| `command` | Fields | OBS requests |
|---|---|---|
| `switch_scene` | `sceneName` | `SetCurrentProgramScene` |
| `set_source_visibility` | `sourceName`, `visible`, `sceneName?` (current program scene when absent) | `GetCurrentProgramScene`, `GetSceneItemId`, `SetSceneItemEnabled` |
| `set_input_mute` | `inputName`, `muted` | `SetInputMute` |
| `list_scenes` | none | `GetSceneList`, `GetSceneItemList` per scene |

The reply is `{ "ok": true }` (with `scenes` for `list_scenes`) or
`{ "ok": false, "error": "<reason>" }`. The scene manager answers every
request, a malformed one included, so a requester only ever times out when no
scene manager is running or OBS stops answering it.

Only the engine sends these: the workflow actions and the api's
`listObsScenes()`. Module code does not get a way to reach this subject (see
[Engine integrity](./engine-integrity.md)); a module that wants OBS changed
returns a value, and a workflow step does the changing.

## Listing scenes

`listObsScenes()` on the engine API sends `list_scenes` and returns

```ts
{ available: true, scenes: { name, sources: { name, sceneItemId, inputKind, enabled }[] }[] }
| { available: false, reason: string }
```

scenes ordered as OBS's scene list shows them, top first. It asks OBS on every
call, so a scene added a moment ago is listed. A UI offering scene and source
names should fall back to a text box when the listing is unavailable.

## The legacy `slobs` subject

The chatbot's `scene_change` and `source_change` commands still arrive on
`slobs` and are handled as before, fire-and-forget. They share the connection
but not the contract: nothing reports whether they worked.
