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
| `ctx.response(success, message)` | Returns a tagged value; the chat-command caller decides whether to send it | Yes |
| `ctx.result(value, events)` | Returns a tagged value; barkloader checks each event against the module's declared eventbus triggers, publishes them itself, and hands `value` to the caller | Yes |
| Webhook handler result | Returns `{ status, headers?, body?, events? }`; the engine checks it, publishes the events itself, then answers the request | Yes |
| `ctx.storage.set` | Writes module storage; the engine emits `module.storage.changed` itself | Yes |
| `ctx.resources.*` | Engine-defined create / delete / list operations | Yes |
| `ctx.twitch.*` | Fixed subject and command table defined by the engine; the module supplies arguments and gets the twitch service's answer. Commands that act on the channel or its chatters need a permission the manifest declares | Yes: a capability, not a channel |
| `ctx.obs.*` | Fixed subjects (`engine.obs.command`, `engine.obs.options`) and function table defined by the engine; the module supplies names and gets the scene manager's answer. Changing OBS needs the `obs.control` permission the manifest declares; listing names needs none | Yes: a capability, not a channel |
| `ctx.chat.sendMessage` | Engine-defined chat sender | Yes |
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

## Reserved subjects

Workflows are user- and module-authored too, and a `publish_event` step publishes on the subject its `eventType` names. The reserved names live in one place, `shared/common/golang/cloudevents/reserved.go`:

- `CommandSubjectPrefixes`: subjects the engine treats as commands. Barkloader refuses an uploaded module that declares one of these as an event (`USER_RESERVED_EVENT_PREFIXES` in `barkloader/lib_module/src/manifest_validate.rs` must match; a test compares them).
- `EngineEventSubjectPrefixes`: facts engine services assert (platform events, sessions, module and run lifecycle). A workflow may not publish these either. Modules are not held to this tier, since a platform module declares the platform events it brings.

An entry ending in `.` reserves a namespace, any other exactly that name. The workflow engine refuses a workflow that publishes under either tier when it registers it (and unregisters the version a refused update would replace), and refuses the publish at run time when the event type came from an expression. The api repeats the check when a workflow is saved (`api/src/workflow/reserved-subjects.ts`, compared against the Go list by a test).
