# Module settings: the UI contract

Every module can declare a set of module-level configuration values in its manifest
(`settings[]` — API keys, tokens, endpoints; see
[Module format → Module-level settings](../barkloader/modules.md#module-level-settings-settings)).
Barkloader registers these into the `module_settings` table at install time with
empty/default values; a streamer fills them in afterward through the RPC methods on
this page. Sandboxed module functions read the resolved values back as
`ctx.module.settings` (see [Sandbox → `ctx.module`](../barkloader/sandbox.md#ctxmodule)).

This is a **different system from widget `settingsSchema`** (per-widget-instance,
surfaced to browser-side widget code as `widgetHost.settings`) — module settings are
per-module, engine-typed, and surfaced to sandboxed function code.

Implemented as capnweb RPC methods on `modulesRoutes`
(`api/src/routes/modules.ts`), the same convention used by essentially everything
else the `api` service exposes (see `api/src/server.ts` — the only endpoints outside
the single `/api` capnweb endpoint are `/health` and the dumb `/overlay/` byte proxy).
There is no separate REST route for module settings. Types referenced without a
qualifier live in `shared/clients/typescript/api/api.ts`.

## Methods

| Method | Params | Returns |
|---|---|---|
| `getModuleSettings` | `moduleId: string` | `ModuleSettingsResponse` — `{ settings: ModuleSetting[] }` |
| `updateModuleSetting` | `moduleId: string, key: string, value: string` | `ModuleSetting` |

```ts
interface ModuleSetting {
  id: string;
  moduleId: string;
  key: string;
  value: string;       // always "" for a `secret` setting
  valueType: string;   // "string" | "number" | "boolean" — set at registration, not by the caller
  isSet?: boolean;     // whether a value is stored; the only way to tell for a secret
}
interface ModuleSettingsResponse {
  settings: ModuleSetting[];
}
```

`moduleId` here is the manifest-local module id (the same id `ctx.module.id` resolves
to at runtime), not the composite `{id}:{version}:{hash}` key used for actions/widgets.

## Behavior notes

- **`updateModuleSetting` cannot change a setting's type.** It always re-derives
  `valueType` server-side from the existing row before writing (defaulting to
  `"string"` only if no row exists yet) — a caller can overwrite `value` but never
  `valueType`. The declared type comes from the manifest's `settings[].type` and is
  fixed at install time.
- **`value` is validated as a string.** A non-string `value` throws rather than being
  passed through.
- **Listing a module with no registered settings returns an empty array**, not an
  error — `ListModuleSettings` on the db side is a plain filter query, not an
  existence check.

## Secret settings

A manifest setting declared `type: "secret"` holds a value the streamer enters and
should never see again: a signing secret, an API key, a token.

- **Stored sealed.** db-proxy encrypts the value (AES-256-GCM, bound to its module id
  and key) before writing it. The key is `WOOFX3_SECRETS_KEY` (env) or `secretsKey`
  (`.woofx3.json`): a base64-encoded 32-byte key, required at startup and injected
  like any other config, so every instance shares it. Changing or losing it makes the
  stored secrets unreadable; the streamer re-enters them.
- **Write-only through these methods.** `getModuleSettings` returns a secret with
  `value: ""` and `isSet`. `updateModuleSetting` seals a non-empty value and clears on
  `""`. A caller cannot change a setting's type, so it cannot turn a secret into plain
  text.
- **Readable only by the owning module.** Barkloader opens the secrets (db-proxy
  `GetModuleSecretValues`) while building `ctx.module.settings` for that module's own
  functions.
- **Upgrades.** A setting that becomes `secret` in a new manifest version has its
  stored value sealed in place; a secret that stops being one is cleared, never
  decrypted into plain text.
- A `secret` setting cannot declare `defaultValue`: the manifest would ship the secret.

Every other type is plain text, stored as `TEXT` and returned as-is. Never declare a
credential as `text`.

## `widget_settings` — not implemented

Migration `0020_module_settings.go` also created a `widget_settings` table (per
`module_id` + `widget_id` + `instance_id` + `key`) with a matching Go model and
repository, apparently intended as a future per-widget-instance counterpart to this
system. As of this writing there is no proto service, no API route, and nothing in
the install flow that reads or writes it. Don't build a UI against it yet — widget
config today goes through the widget's own `settingsSchema` (see
[Widget entry](../barkloader/modules.md#widget-entry-widgets)), which is unrelated to
this table.
