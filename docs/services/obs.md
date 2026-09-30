# OBS control

The engine holds the OBS connection; a module decides when to use it. The
scene manager holds the one OBS WebSocket connection. Module code reaches it
through the `ctx.obs` host extension, which asks the scene manager over NATS
and returns its answer. The workflow actions and name pickers a streamer sees
(switch scene, show or hide a source, mute an input) are declared by the OBS
platform module (`woofx3_obs`, published from woofx3-modules), whose functions
call `ctx.obs`, the same way the Twitch platform module calls `ctx.twitch`.

```
workflow step ─▶ woofx3_obs function ─▶ ctx.obs ──request──▶ engine.obs.command ──▶ sceneManager ──obs-websocket v5──▶ OBS
                                               ◀──{ ok, error? }──────────────────────┘
```

An engine with no OBS module installed has no OBS actions, and an engine
without `ctx.obs` does not advertise the `obs.control`
[capability](./engine-capabilities.md).

## `ctx.obs`

Registered by `ObsExtension` (`barkloader/lib_sandbox/src/extensions/obs.rs`)
and typed in `shared/clients/typescript/module-sdk/src/function-ctx.d.ts`.

| Function | Sends | Returns | Permission |
|---|---|---|---|
| `switchScene({ sceneName })` | `switch_scene` on `engine.obs.command` | `{ ok: true }` | `obs.control` |
| `setSourceVisibility({ sourceName, sceneName?, visible? })` | `set_source_visibility` on `engine.obs.command` | `{ ok: true }` | `obs.control` |
| `setInputMute({ inputName, muted? })` | `set_input_mute` on `engine.obs.command` | `{ ok: true }` | `obs.control` |
| `listScenes()`, `listSources()`, `listInputs()` | `{ list }` on `engine.obs.options` | the option list below | none |

Changing OBS changes what viewers see and hear, so it needs the manifest
permission `obs.control`, which the module install page shows. Listing names
needs none.

Arguments are checked before anything is sent: names must be non-empty
strings, `sceneName` may be absent or empty (the live program scene), and
`visible` / `muted` default to true and accept `true`, `false`, `"true"` and
`"false"`, since a value filled in from a step's parameters reaches the
function as text. A bad call throws with `code: "invalid_arguments"`.

A refusal from the scene manager (OBS not connected, no scene by that name)
throws with OBS's reason as the message and no `code`, so a module action can
let it fail the step with that reason. Calls are bounded like `ctx.twitch`'s:
at most 10 per run, each waiting up to 5 seconds and never past the run's
deadline, with `timeout`, `unavailable` (no scene manager running), `busy`,
`call_limit` and `request_failed` codes for the rest.

## Connecting OBS

OBS 28 and later ship the WebSocket server the scene manager speaks (protocol
v5).

1. In OBS, open **Tools → WebSocket Server Settings**, tick **Enable
   WebSocket server**, and note the port (4455 by default).
2. Leave **Enable Authentication** on and copy the password with **Show
   Connect Info**.
3. Enter the address, port and password in the OBS module's settings
   (`woofx3_obs`: `host`, `port`, `password`).

The scene manager reads those settings from db-proxy on every connect attempt:
`host` and `port` with `ListModuleSettings`, and `password`, a `secret`
setting, with `GetModuleSecretValues`. Anything the module does not supply
comes from the scene manager's own configuration: an engine without the
module, an empty setting, or a port that is not a number from 1 to 65535.

| Variable | Default | Meaning |
|---|---|---|
| `WOOFX3_OBS_HOST` | `127.0.0.1` | Host running OBS, when the module does not say |
| `WOOFX3_OBS_PORT` | `4455` | OBS WebSocket server port, when the module does not say |
| `WOOFX3_OBS_RPC_TOKEN` | none | OBS WebSocket server password, when the module does not say |

Installing the module registers its defaults (`127.0.0.1` and `4455`), so from
then on the module's host and port are used; the variables still supply a
password the module leaves empty.

Saving a module setting publishes `db.module.setting.updated.system` with the
module id and the key, never the value. On one for `woofx3_obs` the scene
manager reconnects at once with the new details, closing the open session or
skipping a pending retry's wait.

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

While not connected, every `ctx.obs` call throws `OBS is not connected
(retrying)`, so an OBS step fails with that reason, and a name picker whose
function returns it as `{ error }` shows it as the reason it has nothing to
offer.

A wrong or missing password is logged separately, as `OBS refused the
connection: check the WebSocket password in the OBS module's settings (or
WOOFX3_OBS_RPC_TOKEN without the module)`, once
each time the reason for failing changes.

A command OBS has not answered within 3.5 seconds fails with `OBS did not
answer within 3.5s; reconnecting to it`, and the scene manager drops that
session and reconnects: a socket that stays open while OBS has stopped
answering would otherwise fail every command until OBS was restarted.

Names are OBS's own: a call names a scene, source or audio input exactly as it
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

Only `ctx.obs` sends these, always as requests, so the scene manager ignores a
message on this subject that has no reply subject, before anything reaches
OBS. An uploaded module cannot declare `engine.` (or any other engine command
subject) as an eventbus trigger event or in a form's request, which would
otherwise let module code get a message published here without the
`obs.control` permission (see [Engine integrity](./engine-integrity.md)).

## Name pickers (`engine.obs.options`)

The workflow builder offers OBS's own names for the OBS module's action fields.
Each field declares a field source that runs one of the module's own functions
(see
[Dynamic-source select fields](../barkloader/modules.md#dynamic-source-select-fields-source-kind)),
and that function returns `ctx.obs.listScenes()`, `listSources()` or
`listInputs()`. The scene manager answers on `engine.obs.options`, a subject
apart from `engine.obs.command` that can only read OBS, so listing never needs
the permission that changing OBS does. Uploaded modules cannot name `engine.`
subjects in a field source at all (see
[Engine integrity](./engine-integrity.md)); `ctx.obs` is the only way in.

| `list` | Function | Options | OBS requests |
|---|---|---|---|
| `scenes` | `listScenes` | Every scene, top of OBS's scene list first | `GetSceneList` |
| `sources` | `listSources` | Every scene's sources, headed by the scene. A source inside a group is labelled `Group › Source` and saved as its own name | `GetSceneList`, `GetSceneItemList` per scene, `GetGroupSceneItemList` per group |
| `inputs` | `listInputs` | Every input, headed `Audio inputs` for audio-only kinds and `Other inputs` for the rest. Global audio devices (Desktop Audio, Mic/Aux) are included | `GetInputList` |

The scene manager's reply is the UI's option list, `[{ "value", "label",
"group"? }]`, which the list function returns as it is, or `{ "error":
"<reason>" }` (not connected, OBS hung, a malformed request), which `ctx.obs`
throws. A field-options function that catches it and returns `{ error }` has
the api relay a failed request, so the picker can show the reason instead of
an empty list. Every list is asked of OBS when the form opens, so a scene added
a moment ago is there.

A field declared `type: "text"` renders as a text box with the options as
suggestions rather than a strict select: a name can still be typed while OBS is
closed, or built from a `${...}` variable, and a typed name OBS does not have is
flagged rather than refused.

## Connection status (`engine.obs.status`)

The api's `getObsStatus()` (capability `obs.status`) asks the scene manager how
its connection is doing, for the OBS module's page. The scene manager answers
`engine.obs.status` from its own state, without touching OBS, so the reply is
immediate whether OBS is up or not:

```json
{ "state": "retrying", "failure": "authentication", "address": "192.168.1.20:4455" }
```

- `state`: `connecting` (first attempt), `connected`, `retrying` or `stopped`.
- `failure`: why the last attempt failed. `authentication` means OBS refused
  the password (close code 4009); `unreachable` means nothing answered at
  `address`, or an open connection was lost. It is null while connected.
- `address`: the `host:port` the latest attempt used. The password is never in
  the reply.

A scene manager that does not answer within 3 seconds comes back from the api
as `{ "state": "unanswered", "failure": null, "address": null }`. That says
nothing about OBS itself.

## The legacy `slobs` subject

The chatbot's `scene_change` and `source_change` commands still arrive on
`slobs` and are handled as before, fire-and-forget. They share the connection
but not the contract: nothing reports whether they worked.
