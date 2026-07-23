# Module settings: the UI contract

Every module can declare a set of module-level configuration values in its manifest
(`settings[]` — API keys, tokens, endpoints; see
[Module format → Module-level settings](../barkloader/modules.md#module-level-settings-settings)).
Barkloader registers these into the `module_settings` table at install time with
empty/default values; a streamer fills them in afterward through the routes on this
page. Sandboxed module functions read the resolved values back as `ctx.module.settings`
(see [Sandbox → `ctx.module`](../barkloader/sandbox.md#ctxmodule)).

This is a **different system from widget `settingsSchema`** (per-widget-instance,
surfaced to browser-side widget code as `widgetHost.settings`) — module settings are
per-module, engine-typed, and surfaced to sandboxed function code.

Implemented in `api/src/module-setting-handlers.ts`, wired into `api/src/server.ts` by
forwarding any path under `/modules/` to `handleModuleSettingRoute` (which returns
`null` on no match so normal 404 handling still applies). Types referenced without a
qualifier live in `shared/clients/typescript/api/api.ts`.

## Routes

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/modules/:moduleId/settings` | — | `ModuleSettingsResponse` — `{ settings: ModuleSetting[] }` |
| `PUT` | `/modules/:moduleId/settings/:key` | `{ value: string }` | `ModuleSetting` |

```ts
interface ModuleSetting {
  id: string;
  moduleId: string;
  key: string;
  value: string;
  valueType: string;   // "string" | "number" | "boolean" — set at registration, not by the caller
}
interface ModuleSettingsResponse {
  settings: ModuleSetting[];
}
```

`moduleId` here is the manifest-local module id (the same id `ctx.module.id` resolves
to at runtime), not the composite `{id}:{version}:{hash}` key used for actions/widgets.

## Behavior notes

- **`PUT` cannot change a setting's type.** `updateModuleSetting` (`api/src/api.ts`)
  always re-derives `valueType` server-side from the existing row before writing
  (defaulting to `"string"` only if no row exists yet) — a client can overwrite
  `value` but never `valueType`. The declared type comes from the manifest's
  `settings[].type` and is fixed at install time.
- **`PUT` body is validated as a string.** A non-string `value` in the request body
  returns `400` with `{ error: "body.value must be a string" }` rather than being
  passed through.
- **Listing a module with no registered settings returns an empty array**, not a 404
  — `ListModuleSettings` on the db side is a plain filter query, not an existence
  check.

## No secrecy guarantees

There is no `secret`/`sensitive` flag anywhere in the manifest schema, the
`module_settings` table, or these routes. `value` is stored as plaintext `TEXT` and
returned verbatim by `GET` — a `clientSecret` or `refreshToken` setting is exposed in
cleartext to any caller of the `GET` route exactly like a non-sensitive value such as
`clientId`. If you're building a settings UI on top of this, do not assume the API
will mask or omit credential-shaped values — any access control has to live in front
of these routes, not inside them.

## `widget_settings` — not implemented

Migration `0020_module_settings.go` also created a `widget_settings` table (per
`module_id` + `widget_id` + `instance_id` + `key`) with a matching Go model and
repository, apparently intended as a future per-widget-instance counterpart to this
system. As of this writing there is no proto service, no API route, and nothing in
the install flow that reads or writes it. Don't build a UI against it yet — widget
config today goes through the widget's own `settingsSchema` (see
[Widget entry](../barkloader/modules.md#widget-entry-widgets)), which is unrelated to
this table.
