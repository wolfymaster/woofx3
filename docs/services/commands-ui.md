# Chat commands & groups: the UI contract

This spec covers everything a UI needs to manage Twitch chat commands and the
"user groups" (roles) that gate them: which `Woofx3EngineApi` methods to
call, the request/response shapes, and the webhook callbacks to handle so the
UI can stay in sync without polling. It does not cover the chat-runtime side
(parsing, cooldown, templating) — see `woofwoofwoof/src/commands.ts` and
`docs/workflow/expressions.md` for that.

All endpoints below are methods on `Woofx3EngineApi`
(`shared/clients/typescript/api/api.ts`), implemented in
`api/src/routes/commands.ts` and `api/src/routes/groups.ts`. Types referenced
without a qualifier (`CommandSnapshot`, `GroupSnapshot`, etc.) live in that
same file; webhook event types live in `shared/clients/typescript/api/webhooks.ts`.

## Concepts

- **Command**: a `!name` chat trigger. `type` is `"text"` (a response
  string, always resolved for `{template}` variables before being sent) or
  `"function"` (invokes a barkloader module function and uses its return
  value as the response — `typeValue` is the function's qualified name,
  e.g. `"my_module/say_hello"`, sourced from `listAvailableFunctions()`).
- **Group**: a named role (e.g. "moderator", "vip"). Users are added to
  groups by username; commands are granted to one or more groups and/or
  specific usernames. This is the *only* permission concept the UI deals
  with — there is no raw Casbin/policy surface to expose.
- **Visibility**: every command is either `"public"` (always allowed, no
  group/user check at all) or `"restricted"` (the invoking chat user must
  belong to one of the command's `groupIds` or be listed in its
  `usernames`). A restricted command with empty `groupIds`/`usernames`
  is invocable by no one — the UI should warn on save if that combination
  is reached, since it's very likely a mistake.
- **Cooldown**: seconds between invocations of a command, enforced
  per-command (not per-user). `0` means never throttle. A throttled
  invocation is dropped silently in chat — there's nothing for the UI to
  observe for that case; it's purely a runtime behavior.
- **Argument pattern**: optional `{variable}` placeholders declaring named
  arguments a command accepts, e.g. `{songTitle}` or `{userA} {userB}`.
  Applies to both `"text"` and `"function"` types — see "Argument
  extraction" below.

## Commands: API contract

```ts
listCommands(): Promise<CommandSnapshot[]>
createCommand(data: CreateCommandInput): Promise<CommandSnapshot>
updateCommand(id: string, data: UpdateCommandInput): Promise<CommandSnapshot>
deleteCommand(id: string, correlationKey?: string): Promise<{ deleted: boolean }>
listAvailableFunctions(): Promise<AvailableFunction[]>
```

```ts
interface CommandSnapshot {
  id: string;
  applicationId: string;
  command: string;            // without the "!" prefix
  type: "text" | "function";
  typeValue: string;          // response text ("text") or qualified function name ("function")
  cooldown: number;           // seconds, 0 = never throttle
  priority: number;
  enabled: boolean;
  visibility: "public" | "restricted";
  groupIds: string[];         // Group.id values; ignored/irrelevant when visibility === "public"
  usernames: string[];        // lowercased chat usernames granted direct access
  argumentPattern: string;    // e.g. "{songTitle}" or "{userA} {userB}"; "" = no named arguments
}

interface CreateCommandInput {
  command: string;
  type: "text" | "function";
  typeValue: string;
  cooldown: number;
  priority?: number;          // defaults to 0
  enabled: boolean;
  visibility: "public" | "restricted";
  groupIds?: string[];        // defaults to []
  usernames?: string[];       // defaults to []
  argumentPattern?: string;   // defaults to "" (no named arguments)
  correlationKey?: string;    // echoed back on the command.created webhook
}

// UpdateCommandInput is the same shape as CreateCommandInput minus
// `correlationKey`'s create-only framing (it's still present, just echoed
// on command.updated instead) - it's a full-replace update: every field is
// required except the optional ones, so send (current snapshot ∪ changes),
// not a sparse patch.
interface UpdateCommandInput {
  command: string;
  type: "text" | "function";
  typeValue: string;
  cooldown: number;
  priority: number;
  enabled: boolean;
  visibility: "public" | "restricted";
  groupIds?: string[];
  usernames?: string[];
  argumentPattern?: string;
  correlationKey?: string;
}
```

`listAvailableFunctions()` returns every function exposed by every installed
module — populate the `"function"`-type command's dropdown from
`qualifiedName` (what you write into `typeValue`) and `name` (what you
display):

```ts
interface AvailableFunction {
  id: string;
  moduleId: string;
  moduleName: string;
  manifestId: string;
  name: string;            // display
  qualifiedName: string;   // → CreateCommandInput.typeValue for type: "function"
  runtime: string;
}
```

### Behavioral notes

- **`command` uniqueness / renaming**: `updateCommand` allows changing the
  `command` string itself (a rename). There's no separate rename endpoint.
- **`priority`** is stored but not currently used by the runtime for
  conflict resolution between commands (there's no scenario today where two
  commands can match the same invocation) — safe to omit / default to `0`
  in the UI unless a future ordering feature needs it.
- **No server-side validation** of `typeValue` non-emptiness. An empty
  `"text"` response is a **valid, intentional** configuration: the command
  matches, still fires the `chat.command.<name>` event (see
  "Triggering workflows from commands" below), but sends nothing to chat.
  Don't add client-side validation that rejects this — it's how a
  UI author builds a "trigger-only" command that exists purely to drive a
  workflow.
- **Group/user assignment writes are full-replace**, not incremental: the
  `groupIds`/`usernames` arrays on `createCommand`/`updateCommand` are the
  complete desired set each time, not a diff. Send the full array your form
  currently holds.
- **`argumentPattern` is validated server-side.** `createCommand`/
  `updateCommand` reject the call (throw) if any `{name}` token inside it
  fails the naming rule below — surface the thrown message as a form error,
  there's no separate "dry-run validate" endpoint to check first.

## Argument extraction (`argumentPattern`)

`command` is always just the bare trigger word ("sr", "hug") — it never
contains `{...}`. The `{variable}` syntax lives entirely in the separate
`argumentPattern` field, which the UI should present as part of authoring a
command (e.g. a field right below the command-name input, with a live
preview of the parsed variable names). It applies to **both** command
types:

- `"text"`: the response can reference the same `{variable}` names via the
  existing `{template}` syntax — e.g. `argumentPattern: "{songTitle}"` with
  `typeValue: "queued: {songTitle}"`.
- `"function"`: the invoked module function receives the extracted values
  in its payload (this is an engine-internal wire detail, not something the
  UI constructs — documented here only so you know why declaring
  `argumentPattern` on a function-type command is meaningful and not
  text-only).

**Extraction rule** (applied to whatever text follows the command word in
chat):

- **Zero variables** (`argumentPattern: ""`): unaffected — today's default
  behavior.
- **Exactly one variable**: captures the *entire* remainder of the message,
  not split on whitespace. `argumentPattern: "{songTitle}"` on `!sr Life is
  a highway` → `songTitle = "Life is a highway"`.
- **More than one variable**: every variable but the last consumes exactly
  one whitespace-delimited token; the last captures whatever text remains.
  `argumentPattern: "{userA} {userB}"` on `!hug alice bob smith` →
  `userA = "alice"`, `userB = "bob smith"`. A missing trailing argument
  resolves to `""`, not an error — `!hug alice` still matches, with
  `userB = ""`.

**Naming rule**: each `{name}` must be one word or dot-separated words —
`^\w+(\.\w+)*$` (letters, digits, underscore; segments joined by literal
dots). No spaces, brackets, or other punctuation. `{songTitle}` and
`{user.name}` are valid; `{song title}`, `{song-title}`, `{song[0]}` are
rejected. Dot-separated names build a nested object for the `text`
resolver — `argumentPattern: "{user.name}"` lets a response reference
`{user.name}` using the resolver's existing dotted-path traversal (the same
mechanism that already lets a response reference `{user}`, just one level
deeper).

Reference implementation for both extraction and naming validation:
`shared/common/typescript/templates/command-variables.ts` (shared by the
engine's API layer and the chat runtime — the UI doesn't need to
reimplement extraction itself, but matching the naming regex client-side
for inline form validation is reasonable if you want immediate feedback
before submit).

## Groups: API contract

```ts
listGroups(): Promise<GroupSnapshot[]>
createGroup(data: CreateGroupInput): Promise<GroupSnapshot>
updateGroup(id: string, data: UpdateGroupInput): Promise<GroupSnapshot>
deleteGroup(id: string, correlationKey?: string): Promise<{ deleted: boolean }>
listGroupMembers(groupId: string): Promise<string[]>
addUserToGroup(groupId: string, username: string): Promise<{ ok: true }>
removeUserFromGroup(groupId: string, username: string): Promise<{ ok: true }>
```

```ts
interface GroupSnapshot {
  id: string;
  applicationId: string;
  name: string;
  description: string;
  createdAt: string;   // ISO 8601
}

interface CreateGroupInput {
  name: string;
  description?: string;
  correlationKey?: string;   // echoed back on the group.created webhook
}

interface UpdateGroupInput {
  name: string;
  description?: string;
  correlationKey?: string;   // echoed back on the group.updated webhook
}
```

### Behavioral notes

- **Membership is by username, not a user id.** `addUserToGroup`/
  `removeUserFromGroup`/`listGroupMembers` all key on the lowercased chat
  username — there's no separate "user" picker/entity to resolve first.
  Usernames aren't validated against any known-users list; a group can
  contain a username for someone who has never chatted yet.
- **`listGroupMembers(groupId)` returns the live roster** — there's no
  paginated/streamed variant. Fine for realistic group sizes (moderator
  lists, VIP lists); don't build incremental loading for this.
- **Deleting a group** does not delete or block on commands that reference
  it. Commands keep the (now-dangling) `groupId` in their `groupIds` array;
  a dangling id is simply never satisfied by any user (equivalent to the
  group having zero members). If you want a "used by N commands" warning
  before delete, you'll need to cross-reference client-side by scanning
  `listCommands()` for the `groupId` — there's no server-side usage-lookup
  endpoint for this today.

## Webhook callbacks

The engine POSTs these to your registered `callbackUrl` (same delivery
mechanism as `workflow.created`/`scene.created` — CloudEvents 1.0 envelope,
`event.type` matches `EngineEventType`, narrow on it for the payload). All
of them are **optional to handle** — nothing breaks if you ignore them and
just call `listCommands()`/`listGroups()` on a timer or on page load instead,
but handling them is what lets you avoid polling and reflect changes made
from other sessions (or from a future "manage via chat command" flow) live.

| Event | `EngineEventType` constant | Fired by |
|---|---|---|
| `command.created` | `COMMAND_CREATED` | `createCommand` |
| `command.updated` | `COMMAND_UPDATED` | `updateCommand` |
| `command.deleted` | `COMMAND_DELETED` | `deleteCommand` |
| `group.created` | `GROUP_CREATED` | `createGroup` |
| `group.updated` | `GROUP_UPDATED` | `updateGroup` |
| `group.deleted` | `GROUP_DELETED` | `deleteGroup` |
| `group.member_added` | `GROUP_MEMBER_ADDED` | `addUserToGroup` |
| `group.member_removed` | `GROUP_MEMBER_REMOVED` | `removeUserFromGroup` |

```ts
interface CommandCreatedEvent {
  type: "command.created";
  applicationId: string;
  correlationKey?: string;    // present iff you passed one to createCommand
  command: CommandWebhookSnapshot;   // same shape as CommandSnapshot
}
// CommandUpdatedEvent is identical, type: "command.updated"

interface CommandDeletedEvent {
  type: "command.deleted";
  applicationId: string;
  correlationKey?: string;
  commandId: string;   // id only — look up the name from your own cache if you need it
}

interface GroupCreatedEvent {
  type: "group.created";
  applicationId: string;
  correlationKey?: string;
  group: GroupWebhookSnapshot;   // same shape as GroupSnapshot
}
// GroupUpdatedEvent is identical, type: "group.updated"

interface GroupDeletedEvent {
  type: "group.deleted";
  applicationId: string;
  correlationKey?: string;
  groupId: string;
}

interface GroupMemberAddedEvent {
  type: "group.member_added";
  applicationId: string;
  groupId: string;
  username: string;
  // no correlationKey - addUserToGroup/removeUserFromGroup don't take one today
}
// GroupMemberRemovedEvent is identical, type: "group.member_removed"
```

### Behavioral notes

- **`correlationKey` is round-tripped, not generated server-side.** If you
  do an optimistic local insert/update before the RPC resolves, generate a
  key client-side, pass it in `CreateCommandInput.correlationKey` /
  `UpdateCommandInput.correlationKey` / the `deleteCommand`/`deleteGroup`
  second argument, and match it against the webhook to reconcile — same
  pattern as `workflow.created`/`scene.created`. If you don't do optimistic
  updates, ignore it entirely; the RPC's own return value already has
  everything you need.
- **`group.member_added`/`group.member_removed` carry no `correlationKey`
  parameter** (`addUserToGroup`/`removeUserFromGroup` don't accept one) —
  match on `(groupId, username)` instead if you need to reconcile an
  optimistic membership-list edit.
- **Delivery is best-effort, fire-and-forget from the engine's side**: a
  webhook failure (your endpoint down, timeout, non-2xx) is logged
  server-side and does **not** roll back or retry the mutation — the RPC
  you called already succeeded and returned the authoritative result.
  Don't build any UI state that depends on the webhook arriving; treat it
  purely as a live-refresh nudge, with the RPC response as the source of
  truth for the mutation you just made yourself, and `listCommands()` /
  `listGroups()` as the source of truth if you ever suspect you've missed
  one.
- **No dedicated `command.execute`/test-invocation webhook.** There's a
  vestigial `executeCommand` RPC in the engine that publishes an internal
  `command.execute` bus event with no subscriber — it does not actually run
  the command and nothing observes it. Don't build a "test run" UI feature
  against it; there's no real execution path here to hook into.

## Triggering workflows from commands

A command does not have a "run this workflow" type. Instead, every command
invocation (regardless of `type`) fires a `chat.command.<name>` bus event
that the *workflow builder* can subscribe to as a trigger — the command must
already exist before it's selectable there. Concretely, the workflow
engine registers a single wildcard trigger definition once (`category:
"chat"`, `name: "Chat Command"`, `event: "chat.command.*"`,
`manifestId: "chat_command"`, surfaced through the normal `getTriggers()`
trigger-picker list) with one config field:

```jsonc
{ "id": "command", "label": "Command", "type": "string", "required": true, "placeholder": "hello" }
```

When the workflow-builder UI resolves that field into the stored
`WorkflowDefinition.trigger`, it should produce:

```jsonc
{
  "event": "chat.command.*",
  "conditions": [
    { "field": "trigger.data.command", "operator": "eq", "value": "<the command name the user typed into the field, without the '!' prefix>" }
  ]
}
```

This is the same wildcard-subject + `Conditions` pattern already used for
every other Twitch trigger with a user-filterable field (e.g. cheer's
minimum-amount threshold) — nothing new to build on the trigger-config
plumbing side, just populate `conditions` the same way you already do for
those.

A "trigger-only" command (empty `"text"` response, per the behavioral note
above) is the intended way to author a command whose only purpose is to
drive a workflow, with no direct chat reply.

## Out of scope

- No bulk/batch endpoints — create/update/delete one command or group per
  call.
- No command execution history/analytics endpoint. `AlertRecordedEvent`
  and friends (`docs/services/*`) cover alert-log style history for a
  different feature; commands have nothing equivalent today.
- No search/filter/pagination params on `listCommands()`/`listGroups()` —
  both return the full list for the current application; filter
  client-side.
- No endpoint to check "which commands can user X currently invoke" —
  that's evaluated at chat-message time in `woofwoofwoof`, not exposed as a
  standalone permission-check RPC. If you need to preview this in the UI,
  compute it client-side from `CommandSnapshot.visibility` /
  `.groupIds` / `.usernames` and `listGroupMembers()`.
