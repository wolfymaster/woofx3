# woofx3 module: developer notes

Facts moved out of the streamer-facing text in `manifest.json`.

## Actions

- `Run module function` (function action): set `function` to the canonical function id. Everything else in `parameters` is passed to the function as one object argument.
- `Run command` executes a chat command's steps with no arguments. The command's permission check is skipped; the command must exist and be enabled.
- `Add a row` returns `reason` of `duplicate` or `full`. `Change a row` returns `missing`. Queue actions return `full` or `duplicate`, and `Move to another queue` adds `missing`.
- `Read a row` returns columns by column id, such as `values.game`.
- Timer and schedule timestamps are milliseconds since the Unix epoch; `null` when stopped (or never run).
- `Print` logs its parameters to the workflow service log, for checking workflow shape and expression resolution.

## Trigger payloads

- Resource triggers (counter, timer, queue, schedule, counter goal) identify the resource by canonical id.
- Workflow created, updated and deleted emit `ID`, `Name`, `Steps`, `Trigger`, `Taxonomy` (JSON-encoded), `CreatedByType` (`USER` or `MODULE`), `CreatedByRef`, `ManifestID` (module id for `MODULE` rows) and `Enabled`.
- Viewer entered or left segment emits `facts`, nested by owner and slug like `${viewer.*}`: fact id `{owner}:fact:{slug}` is at `facts.{owner}.{slug}` as `{ before, after }`. `cause` is `{ source, eventId }`. The segment id has the form `user:segment:<slug>`.
- Form submitted: the submission id is unique and each submission fires once. `submittedAt` is RFC 3339 UTC. A viewer who was not signed in has a null `viewer.platform` and `viewer.platformUserId` and the display name `anonymous`; test `viewer.platformUserId`, not the name. `fields` is a list of `{ id, label, type, value }` (value is a string, or a boolean for a checkbox) and `answers` maps question id to value. Answers are untrusted text.
- Chat command: bind to one command by setting the trigger's `command` field, without its prefix.
