# Unified actions: engine work

The dashboard is moving to one step editor for chat commands, alerts, workflows and the macro pad. This page lists the engine side of that effort. Feature PRs for it target `release/unified-actions` in this repository and in woofx3-ui.

- Plan with the decisions table: <https://claude.ai/artifact/EgRbADAL8PEhj4sxEALhWH>
- UI plan: `docs/plans/unified-actions.md` in woofx3-ui

## Groundwork

- The bundled `woofx3` module files its actions by purpose (`workflow`, `chat`, `overlay.alerts`, `overlay.scenes`, `tools.counter`, `tools.timer`, `tools.queue`) instead of `system.*`. The picker's objects come from these entries.
- `docs/barkloader/modules.md` and `docs/workflow/` are corrected: `resourceKind` on `resource_ref`, `native` actions, and what a wait condition can reference.

## Spec additions the editor needs

- **Decided:** an optional `sentence` on actions, mirroring the trigger `sentence`. Its `{fieldId}` placeholders name the action's own settings and are checked at install; it is stored on the action row, returned by `getActions` and sent to the dashboard with the action. Clients fall back to a sentence built from the setting labels. The bundled actions get sentences in the same change, with a module version bump.

Pending the decisions in the plan:

- `options` on `DataShape` fields, so a condition on an emitted field can offer its known values.
- A way to list the viewer facts `${viewer.*}` resolves, with their types.

## Commands become workflows

The command record keeps what only commands have (name, argument pattern, cooldown, priority, visibility, allowed groups and users, enabled) and links to a stored workflow. When a command matches and passes its checks, the commander runs that workflow by id with the `chat.command.<slug>` event and the captured arguments, instead of the throwaway run from `RunActions`. Running it by id keeps the `chat.command.<slug>` event that every invocation emits from also triggering it.

On upgrade, each command with actions gets a workflow (trigger `chat.command.<slug>`, actions chained in order) and is linked to it. The migration is idempotent; commands without a linked workflow keep the old path until migrated.

## Follow-ups found along the way

- A counting wait exports both `count` and `sum` but only advances the one its strategy uses; the threshold strategy tracks neither.
- After a wait times out with no event and carries on, `${wait.data.x}` fails to resolve instead of being empty.
- Values inside a list (an `in` item or a `between` bound) are never resolved, so they can't be variables.
- The `v0.34.2` release image failed its health check when a preview tried to start it.
