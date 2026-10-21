# Local UI settings

Some of the dashboard's data belongs to the dashboard rather than to the engine: dashboard layouts, notes, counters and macros. With an account, Convex stores it. A dashboard run without an account (the desktop app's local mode) has no Convex, so the engine keeps it instead, in the `local_ui_settings` table. The table is built so that its contents can later be synced with Convex once the streamer creates an account.

The engine stores the values and never interprets them. What a namespace holds, and the shape of its values, is the dashboard's business.

## The table

Only the db proxy reads or writes it (`LocalUISettingService`, `db/proto/v1/local_ui_setting.proto`). The api serves it to the dashboard over the authenticated capnweb session, behind the `ui.settings` [capability](./engine-capabilities.md).

| Column | Type | Meaning |
|---|---|---|
| `namespace` | text | The kind of data: `dashboardLayouts`, `dashboardNotes`, `dashboardCounters`, `macros`. At most 64 bytes. |
| `key` | text | The setting within its namespace, often an id the dashboard made. At most 256 bytes. |
| `value` | JSON text | The value, at most 256 KiB once encoded. NULL exactly when `deleted`. |
| `revision` | int64 | The engine-wide revision of the row's last write. Unique across the table. |
| `updated_at` | timestamp | When the row was last written. |
| `deleted` | bool | True for a tombstone. |

`(namespace, key)` is the primary key: a setting has one row for its whole life, through every set and delete.

## Revisions

Every write, a set or a delete, takes the next value of one engine-wide counter (`local_ui_settings_revision`, a single row), in the same transaction as the write. Revisions therefore rise across every namespace, and a single number says how far a reader has got through every change the engine has seen.

The counter is a row bumped inside the transaction rather than a database sequence for one reason: ordering. A sequence hands out its number outside the transaction, so a write given revision 6 can commit before a write given revision 5. A reader that saw 6 and then asked for "everything after 6" would never see 5. Bumping a row holds that row's lock until the write commits, so writes are serialised and become visible in revision order. A refused or failed write rolls back and consumes no revision.

## Tombstones

A delete does not remove the row. It sets `deleted`, clears `value`, and gives the row a new revision. That is how a reader of changes learns that a setting went away: a removed row would leave nothing to report.

Tombstones are left out of `listUISettings` and `getUISetting`, which describe what the dashboard has now. `listUISettingChangesSince` includes them. Deleting a key that was never written stores a tombstone too, so the delete still reaches a sync. Setting a tombstoned key brings it back with a new revision.

## Conflicts

`setUISetting` and `deleteUISetting` take an optional `expectedRevision`:

- **Absent:** the write is unconditional.
- **A revision:** the write goes through only if the stored row has that revision.
- **0:** the write goes through only if the key has no live value: it was never written, or is a tombstone. This is "create only if absent".

A refused write changes nothing and answers with the stored row, so the caller can merge and retry without a second read:

```ts
type UISettingWriteResult =
  | { ok: true; setting: UISetting }
  | { ok: false; reason: "conflict"; current: UISetting | null }; // null: never written
```

`current` may be a tombstone (`deleted: true`). The check and the write happen in the same transaction, after the counter is bumped, so no other write can land between them.

A namespace or key that is empty or too long, a value JSON cannot represent, and a value over the cap are refused with an error rather than a result.

## Changes and the webhook

Each successful write sends a `ui.setting.changed` webhook (`UISettingChangedEvent` in `@woofx3/api/webhooks`) carrying the namespace, key, revision, `deleted` and value. The webhook is a notification, delivered best effort. A consumer that keeps a copy holds the highest revision it has applied for each key and drops a delivery that is not above it.

`listUISettingChangesSince(revision, limit?)` is the record. It returns every row whose revision is greater than `revision`, tombstones included, oldest first, up to `limit` (100 by default, at most 500), with `hasMore` when more follow. To read everything, start at 0 and ask again from the last revision returned until `hasMore` is false. Each row appears once, at its latest revision, so a key written many times since the cursor costs one row.

## Syncing with Convex

The table carries what a sync needs, without the engine knowing about Convex. A sync that runs once the streamer has an account:

1. **Pulls engine changes.** It pages `listUISettingChangesSince` from the last revision it stored, applies each row to Convex (a tombstone deletes), and stores the last revision it applied. If it stops halfway, it resumes from that revision and applies the same rows again, which is harmless because each row is the setting's whole latest state.
2. **Pushes Convex changes.** For each setting changed in Convex, it calls `setUISetting` or `deleteUISetting` with `expectedRevision` set to the engine revision it last saw for that key, or 0 for a key it has never seen in the engine. A write that goes through gets a new revision, which the next pull returns too; the sync recognises its own write by that revision and skips it.
3. **Resolves conflicts.** A conflict means the engine's copy changed after the sync last saw it. The result carries the engine's current row; the sync decides which wins (or merges), and retries with that row's revision.

Live `ui.setting.changed` deliveries can shorten the time to the next pull, but the sync never depends on them: the changes list is the source of truth.
