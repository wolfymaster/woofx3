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
| Webhook handler result | Returns `{ status, headers?, body?, events? }`; the engine checks it, publishes the events itself, then answers the request | Yes |
| `ctx.storage.set` | Writes module storage; the engine emits `module.storage.changed` itself | Yes |
| `ctx.resources.*` | Engine-defined create / delete / list operations | Yes |
| `ctx.twitch.*`, `ctx.platform.alerts.*`, `ctx.platform.chat.*` | Fixed subject and command table defined by the engine; the module supplies arguments | Yes: a capability, not a channel |
| `ctx.chat.sendMessage` | Engine-defined chat sender | Yes |
| `ctx.crypto.*` | Pure computation over the arguments (HMAC, Ed25519 verification, constant-time comparison) | Yes: nothing reaches the engine |

## Applying it

When designing anything module code can reach (a sandbox binding, a manifest field, a function's return contract):

1. Decide what the engine should do with the function's result, and have the function return it.
2. The engine validates the returned value (shape, reserved subjects and prefixes, size and count caps) before acting, and fails closed.
3. If an effect during execution is unavoidable, add a narrow host capability with an engine-defined target, never a general-purpose channel.
4. Never add a binding that takes a subject, event type, or workflow id from module code and publishes or dispatches it verbatim.
