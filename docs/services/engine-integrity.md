# Engine integrity: modules request, the engine acts

Module code is written by end users and runs inside the barkloader sandbox. It must never drive the engine directly. A module describes what it wants; the engine decides whether and how that happens.

## The rule

- A module function does not put events on the message bus, choose NATS subjects or event types for the engine to publish verbatim, start workflows, or otherwise trigger engine behavior on its own authority.
- When a module needs the engine to act, the function **returns** a value in a platform-defined shape. The engine validates it and performs the effect, or refuses.
- When a module needs a side effect during execution, the engine offers a narrow capability whose target and meaning the engine defines: a fixed subject and command table, a storage write, a resource API. The module supplies arguments, never the channel.

## Why

The message bus is the engine's control plane. Triggers, workflows, chat commands and outbox events all travel on it. Raw access would let a module:

- impersonate any event source (`channel.cheer`, a `db.*` outbox event, another module's subjects) and fire every workflow bound to it;
- publish before the engine has decided the work is valid, such as data from a request that has not been verified yet;
- bypass the validation, caps and provenance the engine applies to everything it publishes itself.

Returning values keeps ordering, validation and attribution in one place the engine owns, and makes a module function testable as input in, result out.

## Current surfaces

| Surface | Model | Fits the rule |
|---|---|---|
| `ctx.response(success, message)` | Returns a tagged value that becomes the step's output; a later engine action such as `chat.reply` decides what to do with it | Yes |
| `ctx.result(value, events)` | Returns a tagged value; barkloader checks each event against the module's declared eventbus triggers, publishes them itself, and hands `value` to the caller | Yes |
| Webhook handler result | Returns `{ status, headers?, body?, events? }`; the engine checks it, publishes the events itself, then answers the request | Yes |
| `ctx.storage.set` | Writes module storage; the engine emits `module.storage.changed` itself | Yes |
| `ctx.resources.*` | Engine-defined create / get / delete / list operations. A module deletes only its own instances and reads its own plus the ones the streamer linked to it through a `resource_ref` setting, which module code cannot write (the link is the streamer's pick, or what the manifest's install-time `create` set) | Yes |
| `ctx.resources.run` | Runs the providing module's `{kind}.{verb}` function action on an instance the module owns or its `resource_ref` settings link to; the caller must declare the provider's permissions, and a `systemOnly` action is never runnable | Yes: the instance was linked by the streamer or at install, and the action is one the provider declared |
| `ctx.twitch.*` | Fixed subject and command table defined by the engine; the module supplies arguments and gets the twitch service's answer. Commands that act on the channel or its chatters need a permission the manifest declares | Yes: a capability, not a channel |
| `ctx.obs.*` | Fixed subjects (`engine.obs.command`, `engine.obs.options`) and function table defined by the engine; the module supplies names and gets the scene manager's answer. Changing OBS needs the `obs.control` permission the manifest declares; listing names needs none | Yes: a capability, not a channel |
| `ctx.oauth.request` | Engine-defined: the module names an integration its manifest declares; the engine attaches the token it keeps, refreshes it, and sends it only to the integration's hosts, enforced even under `WOOFX3_MODULE_HTTP=log`, and never across a redirect to another origin. Module code never holds a client secret or a token | Yes: a capability, not a channel |
| `ctx.http.request` | Reaches only hosts the manifest declares as `net:<host>` permissions, approved at install, and URLs the streamer entered in `url` settings; redirects and resolved addresses are checked too, and credential headers are dropped on a cross-origin redirect. Enforced by default; `WOOFX3_MODULE_HTTP=log` is a migration opt-in that logs ungranted destinations instead. Private, loopback and link-local addresses are refused in both modes unless `WOOFX3_MODULE_HTTP_ALLOW_PRIVATE=true` | Yes, unless an operator opts into `log`: the streamer approves every destination |
| `ctx.crypto.*` | Pure computation over the arguments (HMAC, Ed25519 verification, constant-time comparison) | Yes: nothing reaches the engine |
| Manifest field `source` and button `action` (`kind: "internal"`) | The api sends the declared request when a form renders or a button is pressed. Barkloader accepts, for an upload, only `barkloader.module.field_options` for the module's own functions and the allowlisted `twitchapi` reads (`listChannelPointRewards`). The system module's forms may read engine subjects | Yes: a read the engine allows, never a command subject |
| Workflow steps and command actions in a manifest | Name actions by canonical id, including the bundled module's; an action declared `systemOnly` is refused (see below) | Yes |

## System-only actions

A module does not have to call a capability to use it: a workflow or command
in its manifest can name any installed action by canonical id, bundled ones
included, and the engine runs it with the module's say-so. So a limit on a
sandbox capability also has to hold for the actions a manifest can reference,
or it is only a limit on which door is used.

An action declaration can carry `"systemOnly": true`. Barkloader then refuses
to install any module that is not a bundled system module when one of its
workflow steps or command actions names that action, and names the step in the
error. Only a system module may declare the flag, and the set is read from the
modules embedded in the barkloader binary, so it cannot drift from what is
installed. The streamer's own workflows, built in the UI, are unaffected: the
limit is on module code, not on the person running the engine.

When adding an action to a bundled module, decide whether module code could
already ask for the same effect through a capability; if not, declare it
`systemOnly`.

## Applying it

When designing anything module code can reach (a sandbox binding, a manifest field, a function's return contract):

1. Decide what the engine should do with the function's result, and have the function return it.
2. The engine validates the returned value (shape, reserved subjects and prefixes, size and count caps) before acting, and fails closed.
3. If an effect during execution is unavoidable, add a narrow host capability with an engine-defined target, never a general-purpose channel.
4. Never add a binding that takes a subject, event type, or workflow id from module code and publishes or dispatches it verbatim.
5. When a capability acts on something the streamer would want to approve (the channel's settings, its chatters), require a manifest permission for it (see [Module format → Permissions](../barkloader/modules.md#permissions-permissions)). Permissions are declared by the module and enforced by the engine, and shown on the module install page (woofx3-ui feat/module-permissions-review). The host refuses an undeclared call before anything is sent, and an upload that names another module's action must declare that module's permissions, so what a module can do is fixed at install rather than discovered at runtime.

## Reach into the streamer's network

What a module reaches on the streamer's own network is declared in its
manifest's `local[]` (see [Module format → Local endpoints](../barkloader/modules.md#local-endpoints-local)),
shown on the module install page beside its permissions, and fixed at install
like them. An entry names settings that hold an address; it never carries an
address the platform dials on the module's say-so.

When an endpoint goes through the woofx3 companion, the engine names only
`(moduleId, endpointId)` on the bridge. The engine never tells the companion an
address: the companion dials only an address it discovered itself or the
streamer confirmed in its own window, and only for endpoints of modules
installed on its instance. So neither a module's settings nor a compromised
engine can point the companion at another device on the network. See
[Local endpoints](./local-endpoints.md).

## Requests the dashboard asks for

A manifest field's `source` and a settings button's `action` (`kind: "internal"`) are requests the api sends on the dashboard's behalf, when a form renders or a button is pressed. The dashboard never supplies them: it names the field (module id, declaration, declaration id, field id) and the api reads the request from the installed module's stored manifest, refusing a field that does not exist or a request descriptor sent in place of a reference. So a signed-in dashboard user can ask only for requests an installed module declared, never an arbitrary command on an arbitrary subject. See [dynamic-source select fields](../barkloader/modules.md#dynamic-source-select-fields-source-kind).

## Reserved subjects

Workflows are user- and module-authored too, and a `publish_event` step publishes on the subject its `eventType` names. The reserved names live in one place, `shared/common/contracts/reserved-subjects.json`, which the workflow engine (through the generated `shared/common/golang/cloudevents/reserved_data.go`; run `go generate ./...` in that package after editing the JSON), the api and barkloader all read:

- `commandSubjectPrefixes`: subjects the engine treats as commands. Neither a workflow nor an uploaded module may use them. The platform gateway namespace (`platform.gateway.`: send, capabilities, field options) is one of them: those subjects are answered by the connectors host, which posts to a streaming platform for the caller, so a workflow, an uploaded module or the api test-fire routes publishing there would drive a platform instead of asking the engine. It is deliberately absent from the allowlist of form requests an uploaded module may declare; the dashboard reaches the gateway only through the api.
- `engineAssertedPrefixes`: facts engine services assert (platform events, chat command invocations, command changes, sessions, module and run lifecycle). A workflow may not publish these either.
- `platformEventEntries`: the engine-asserted entries that hold platform events, which a creator can fire with `simulateTwitchEvent` instead.
- `uploadReservedPrefixes`: the engine-asserted events an uploaded module may not declare as eventbus triggers, on top of the command subjects. A webhook handler may publish its module's eventbus trigger events verbatim, so declaring one would let the upload forge it. Platform events a platform module brings (`channel.`, `channelpoints.`, `user.message`, `stream.online`, `stream.offline`) are left out. Under `module.` an upload may declare events in `module.<its id>.` only, and only when its id has no `.` and is not one of `engineModuleSegments`, the namespaces the engine publishes module lifecycle events in (`module.change.`, `module.trigger.`, ...). The bundled system module is exempt from everything but the webhook prefix.

An entry ending in `.` reserves a namespace, any other exactly that name. `message.send` is a retired command: chat now goes out through the platform gateway, but the name stays reserved so a workflow or module cannot take it over. The workflow engine refuses a workflow that publishes under either tier when it registers it (and unregisters the version a refused update would replace), and refuses the publish at run time when the event type came from an expression. The api repeats the check when a workflow is saved (`api/src/workflow/reserved-subjects.ts`). Barkloader matches every entry as a prefix when it checks a manifest, so it is the stricter of the two on exact-name entries. The check runs at install and again when a module's functions are loaded, against the stored manifest, so a module installed before a subject was reserved loses the ability to publish it without a reinstall.

The api's test-fire routes hold the same line. `triggerEvent` publishes any subject the caller names, so it refuses every reserved one (`testEventProblem("trigger", ...)` in the same file); `simulateTwitchEvent` stamps the Twitch platform on what it publishes, so it accepts only the `platformEventEntries`. Both refuse an empty type, wildcards, whitespace and control characters, and the refusal reaches the caller as the error message. `simulateTwitchEvent` logs the event type only, never the event data. Both also refuse an empty token (a leading, trailing or doubled dot). Remaining risk: `simulateTwitchEvent` trusts the caller for platform events, so any authenticated api caller can publish `chat.command.*` and `channel.*` events with any payload, stamped as Twitch; whatever consumes `chat.command.*` must not take a user's role or privileges from the payload.

Residual risk: the platform events left out of `uploadReservedPrefixes` stay open to every upload, so an uploaded module can declare one and forge it from a webhook handler. Closing this needs a host-granted platform capability that only bundled or verified platform modules hold; it is not built yet.
