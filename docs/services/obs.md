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

The scene manager keeps itself connected. If OBS is not running when it
starts, or the connection drops (OBS closed or restarted), it retries in the
background: after 1s, then doubling up to every 30s, each delay jittered down by
up to half. OBS can be started in any order. It logs only the changes
(`OBS not reachable; retrying in the background`, `OBS connection lost;
reconnecting in the background`, `Connected to OBS`, `Reconnected to OBS`), so
an evening with OBS closed is one line, not one per retry.

Each new session reloads the scene list the legacy `slobs` bridge uses. OBS
browser sources pointing at the scene manager are refreshed on the first
session after the scene manager starts, to recover overlays after a restart
of the scene manager itself. They are not refreshed after a reconnect, because
their event streams are still open and a refresh would cut off whatever is
playing.

While not connected, every `obs.*` step fails with `OBS is not connected
(retrying)`, and the name pickers in the workflow builder show that as the
reason they have nothing to offer.

A wrong or missing password is logged separately, as `OBS refused the
connection: check the OBS WebSocket password (WOOFX3_OBS_RPC_TOKEN)`, once
each time the reason for failing changes.

A command OBS has not answered within 3.5 seconds fails with `OBS did not
answer within 3.5s; reconnecting to it`, and the scene manager drops that
session and reconnects: a socket that stays open while OBS has stopped
answering would otherwise fail every command until OBS was restarted.

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
| `set_source_visibility` | `sourceName`, `visible`, `sceneName?` (current program scene when absent) | `GetCurrentProgramScene`, `GetSceneItemList`, `GetGroupSceneItemList` per group when the source is not at the top level, `SetSceneItemEnabled` (on the group, for a source inside one) |
| `set_input_mute` | `inputName`, `muted` | `SetInputMute` |

`switch_scene` sets the program scene, so it changes what is live even in
studio mode.

The reply is `{ "ok": true }` or `{ "ok": false, "error": "<reason>" }`. The scene manager answers every
request, a malformed one included, so a requester only ever times out when no
scene manager is running or OBS stops answering it.

Only the engine's workflow actions send these, always as requests, so the
scene manager ignores a message on this subject that has no reply subject,
before anything reaches OBS. An
uploaded module cannot declare `engine.` (or any other engine command subject)
as an eventbus trigger event, which is the one way module code could otherwise
get a message published here (see [Engine integrity](./engine-integrity.md)).
A module that wants OBS changed returns a value, and a workflow step does the
changing.

## Name pickers (`engine.obs.options`)

The workflow builder offers OBS's own names for the `obs.*` actions' fields
through the generic manifest field source (see
[Dynamic-source select fields](../barkloader/modules.md#dynamic-source-select-fields-source-kind)).
Each field in `modules/woofx3/manifest.json` declares

```json
"source": {
  "kind": "internal",
  "request": { "event": "engine.obs.options", "payload": { "list": "scenes" } },
  "timeoutMs": 5000
}
```

and the api's `dispatchFieldOptionsRequest` sends that request when the form
renders. The scene manager answers on `engine.obs.options`, a subject apart
from `engine.obs.command` that can only read OBS: a field source's payload is
whatever its manifest wrote, so it must not name a subject that changes
anything. Uploaded modules cannot name `engine.` subjects in a field source at
all (see [Engine integrity](./engine-integrity.md)).

| `list` | Used by | Options | OBS requests |
|---|---|---|---|
| `scenes` | `obs.switch_scene.sceneName`, `obs.set_source_visibility.sceneName` | Every scene, top of OBS's scene list first | `GetSceneList` |
| `sources` | `obs.set_source_visibility.sourceName` | Every scene's sources, headed by the scene. A source inside a group is labelled `Group › Source` and saved as its own name | `GetSceneList`, `GetSceneItemList` per scene, `GetGroupSceneItemList` per group |
| `inputs` | `obs.set_input_mute.inputName` | Every input, headed `Audio inputs` for audio-only kinds and `Other inputs` for the rest. Global audio devices (Desktop Audio, Mic/Aux) are included | `GetInputList` |

The reply is the UI's option list, `[{ "value", "label", "group"? }]`, or
`{ "error": "<reason>" }` (not connected, OBS hung, a malformed request), which
the api relays as a failed request so the picker can show the reason. Every
list is asked of OBS when the form opens, so a scene added a moment ago is
there.

The fields are `type: "text"`, which the UI renders as a text box with the
options as suggestions rather than a strict select: a name can still be typed
while OBS is closed, or built from a `${...}` variable, and a typed name OBS
does not have is flagged rather than refused.

## The legacy `slobs` subject

The chatbot's `scene_change` and `source_change` commands still arrive on
`slobs` and are handled as before, fire-and-forget. They share the connection
but not the contract: nothing reports whether they worked.
