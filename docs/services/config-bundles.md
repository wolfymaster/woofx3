# Config bundles

A **config bundle** is a creator's configuration as one JSON file: the
workflows, chat commands, command groups and module resource instances
(counters, timers, queues, and any other kind a module declares) they built.
It exists for three jobs:

- **Backup** before experimenting, restored with an import.
- **Moving** a setup to another engine: a reinstall, or local to hosted.
- **Sharing** a setup with another creator.

Module storage replication covers module *data*; a bundle covers what the
creator *configured*. Three engine RPCs on `Woofx3EngineApi` implement it:
`exportConfig`, `previewImport` and `importConfig`. Types live in
`shared/clients/typescript/api/config-bundle.ts`; the implementation in
`api/src/config-bundle/`.

## The format

```json
{
  "format": "woofx3.config",
  "version": 1,
  "exportedAt": "2026-09-28T12:00:00.000Z",
  "engineVersion": "1.4.0",
  "includeMembers": false,
  "requires": [{ "moduleId": "counter", "version": "2.0.0" }],
  "workflows": [
    {
      "name": "Follow hype",
      "enabled": true,
      "definition": { "name": "Follow hype", "description": "", "trigger": { "...": "..." }, "tasks": [] },
      "workflowRefs": { "thank": "Thank follower" },
      "requires": ["counter", "woofx3"]
    }
  ],
  "commands": [
    {
      "command": "vanish",
      "enabled": true,
      "cooldown": 30,
      "priority": 1,
      "visibility": "restricted",
      "argumentPattern": "{target}",
      "actions": [{ "action": "chat.reply", "parameters": { "message": "poof" } }],
      "groups": ["Moderators", "VIPs"],
      "requires": ["woofx3"]
    }
  ],
  "groups": [{ "name": "VIPs", "description": "Trusted chatters" }],
  "resources": [
    {
      "module": "counter",
      "kind": "counter",
      "instanceId": "follows",
      "displayName": "Follows",
      "settings": { "initialValue": 0, "lifetime": "forever", "step": 1 },
      "requires": ["counter"]
    }
  ]
}
```

**Nothing is addressed by database id.** Ids are minted per engine, so a
bundle names everything the way a person would: a workflow or group by name, a
command by its word, a resource by its canonical id
`{module}:{kind}:{instanceId}` (which is also what workflows and widgets
reference it by, so those references survive the move unchanged).

- A command's group grants are carried as **group names** in `groups`.
- A sub-workflow step's `workflow.workflowId` is blanked, and the target is
  recorded by name in `workflowRefs` (task id to workflow name). A step whose
  target no longer existed on the exporting engine is blanked with no entry.
  Import refuses a bundle whose `workflowId` is not empty.
- Names must be unique per section. Export fails, naming the duplicates, if
  two workflows (or groups, or commands) share one, since every reference to
  that name would be ambiguous.

**Stable output.** Every section is sorted by its identity and every object's
keys are sorted, so two exports of an unchanged setup differ only in
`exportedAt`, and a bundle kept in git diffs cleanly.

### What is exported

Only what the creator authored:

- workflows and commands whose `created_by_type` is `USER` (a module's own
  workflows and commands come back when the module is installed);
- groups that are not built in (built-in groups exist on every engine);
- every module resource instance, with the settings it was created with.

### What is never exported

- The engine's stored credentials: the Twitch token, API clients, the webhook
  signing secret, overlay tokens. Export does not read settings, module
  settings, overlay tokens or clients at all; the tests fail if it does.

  This does **not** make a bundle secret-free. Workflow step parameters,
  command actions and resource settings are exported verbatim, and whatever a
  creator typed into them (an API key pasted into a step, a webhook URL with a
  token in it) goes along. Read a bundle before sharing it.
- Module settings. They are the only place a `secret`-typed value can live,
  and they belong to the module install, not the creator's authored setup.
- **Live values** of counters, timers and queues. A bundle describes the
  setup; `state:<canonicalId>` in module storage is runtime state that the
  module owns (a session counter clears itself, for one), and writing it back
  would bypass the module.
- **Usernames**, unless the export asks for them. Group members and a
  command's per-user grants (`usernames`) are other people's personal data,
  and a bundle is made to be shared. `exportConfig({ includeMembers: true })`
  adds `members` to groups and `usernames` to commands, and the bundle records
  that it did in `includeMembers`.

### `requires`

Every module the bundle's items reference, with the version each was exported
from. Each item also lists the module ids it needs in its own `requires`, so
the import plan can say which items a missing module affects. A reference is:

- a workflow step's `action` (or a command action's `action`) that a module
  registered;
- a workflow trigger's `event` that a module declares;
- any string, anywhere in a trigger, a step's parameters, a command's actions
  or a resource's settings, shaped like a canonical id whose first segment is
  an installed module id (a function a step calls, a counter it changes, a
  theme);
- a resource instance's own module.

## Validation

`previewImport` and `importConfig` accept the bundle as the decoded object or
as the file's raw text, and refuse it before reading any engine state when:

- it is larger than **5 MiB**, or a section has more than **1000** items;
- `format` is not `woofx3.config`, or `version` is not `1`;
- any object has a field the format does not define (an unknown field is a
  newer format or a bad hand edit; silently dropping it would import something
  other than what the file says);
- a workflow definition carries an `id`, or its `name` differs from the item's,
  or a sub-workflow step carries a non-empty `workflowId`;
- two items in one section share an identity;
- an item requires a module that the bundle's top-level `requires` omits.

Every problem is reported at once, with its path (`workflows[0].definition.id`).

## Importing

### The plan

`previewImport(bundle, { onConflict, include, applyMembers })` reads the
engine and returns what `importConfig` would do, writing nothing:

```ts
interface ConfigImportPlan {
  onConflict: "skip" | "rename" | "overwrite";
  applyMembers: boolean;
  items: Array<{
    kind: "workflow" | "command" | "group" | "resource";
    key: string;          // identity in the bundle
    action: "create" | "update" | "skip" | "conflict";
    targetName: string;   // name on this engine; differs from key when renamed
    targetId?: string;    // existing item, for update and skip
    reasons: Array<{ code: string; message: string; blocking: boolean }>;
  }>;
  summary: { create: number; update: number; skip: number; conflict: number };
  missingModules: Array<{ moduleId: string; version: string }>;
}
```

Items are listed in the order they are applied: **groups, resources,
workflows, commands**. Commands are granted to groups; workflows reference
resources and each other, and referenced workflows are ordered before the ones
that start them.

How an item's action is decided:

1. **Blocking problems win.** The item is a `conflict` when:
   - a module it requires is not installed (`missing_module`);
   - a resource's module declares no such kind (`unknown_resource_kind`);
   - it fails the validation a save through the API applies (`invalid`): the
     workflow definition validator, and for commands the `{variable}` name
     check and the action-list check;
   - a command is granted to a group, or a workflow starts a workflow, that
     neither the bundle nor the engine has (`unknown_group`,
     `unknown_workflow`);
   - a group or workflow it depends on will not be imported, or is part of a
     reference cycle (`dependency_blocked`).
2. **Identical items are skipped** (`identical`), whatever the policy. This is
   what makes re-importing a bundle harmless.
3. **A taken name** is decided by `onConflict`:
   - `skip` (the default): `conflict` with `name_collision`; what is there is
     kept.
   - `rename`: `create` under a free name, `Name (imported)` then
     `Name (imported 2)` for workflows and groups, `word-imported` then
     `word-imported-2` for commands. If an earlier import already created an
     identical copy under one of those names, the item is skipped instead.
     When all 100 candidates are taken the item is a `conflict`
     (`rename_exhausted`).
     Resources are never renamed: a colliding resource stays a `conflict`,
     because renaming it would break every workflow referencing its canonical
     id.
   - `overwrite`: `update` the existing item.
4. **What a module owns is never replaced.** A name taken by a
   module-registered workflow or command is a `conflict` (`not_owned`) under
   `skip` and `overwrite`; `rename` imports alongside it. A group matching a
   built-in group is skipped, and commands granted to it keep the grant.

**Dependents follow their dependencies.** A command's groups and a
workflow's sub-workflow targets are resolved through what the plan decided
for them before the dependent is compared or applied: a group imported as
`VIPs (imported)` is the group the command is compared against and granted
to. That is what keeps a second `rename` import of the same bundle from
creating `(imported 2)` copies. A dependency left in conflict by a `skip`
name collision resolves to the item already there, since the creator chose to
keep it; any other conflict blocks its dependents.

Non-blocking reasons are warnings: `module_version_mismatch` (installed at a
different version than exported from), `unknown_action` (a step runs an action
this engine has not registered), `privileged_action` (a step runs an
action that is privileged; see below), `grants_access` and `members_not_applied`
(below), `renamed`, `overwrite`.

### Privileged actions

An action is privileged when the installed module that owns it declares any
`permissions` in its manifest, since every action a module owns runs with all
of them, or when its manifest entry is marked `systemOnly`. The warning names
the action, the owning module and the permissions it runs with. The rule
reads only manifests, so the engine holds no list of platform action names:
a platform module that asks for moderation or channel permissions marks its
own actions. An action that no installed module owns is not flagged,
because nothing on this engine says what it can reach. A manifest without `permissions` declares none.

### Members and usernames

A bundle exported with `includeMembers` carries group members and per-user
command grants. Import leaves them out unless `applyMembers: true` is passed:
a bundle from someone else would otherwise give their usernames access to
commands here. Without it, each affected item carries `members_not_applied`.
With it, each item that would add anyone carries `grants_access`, naming
every username it adds. Members and usernames are only ever added, never
removed.

### Applying

`importConfig(bundle, { onConflict, include })` plans again against the
engine's current state, never trusting an earlier preview, then applies each
`create` and `update` through the **same API methods a save in the UI uses**
(`createWorkflow`, `updateCommand`, `createResourceInstance`, and so on). So
every item is validated again, the internal bus events fire, and the usual
webhooks tell the UI about each change.

- Workflows keep their `enabled` state. `createWorkflow` stores a new
  workflow disabled, so a disabled one is created in its final state; an
  enabled one is enabled by a second call, and if that call fails the item is
  reported `created` with a `warning` saying it was left disabled. An
  overwrite that disables a workflow disables it before replacing its steps.
- A dependent is resolved to the id its dependency got in this import, or to
  the existing item a `skip` name collision kept. If the dependency failed,
  or was never imported, the dependent fails with the dependency's error
  instead of binding to an unrelated item that shares the name.

db-proxy has no transaction spanning workflows, commands, groups and module
resources, so import is **best-effort per item**: one that fails is reported
and the rest still apply. Whatever applied is safe to keep, because importing
the same bundle again skips everything that made it and retries the rest.

```ts
interface ConfigImportResult {
  items: Array<{
    kind: "workflow" | "command" | "group" | "resource";
    key: string;
    action: "create" | "update" | "skip" | "conflict";
    outcome: "created" | "updated" | "skipped" | "conflict" | "failed";
    name?: string;
    id?: string;
    error?: string;
    warning?: string;  // written, but not completely (left disabled, a member not added)
  }>;
  summary: { created: number; updated: number; skipped: number; conflict: number; failed: number };
}
```

## Not covered

- **Scenes and alert layouts.** They reference widget instances and uploaded
  assets, which need their own portability story.
- **Uploaded assets.** A `media` or `asset` field keeps the resource id it was
  exported with, which only resolves on the engine it came from.
- **Module installs.** A bundle names the modules it needs; installing them is
  a separate step, prompted by `missingModules`.
