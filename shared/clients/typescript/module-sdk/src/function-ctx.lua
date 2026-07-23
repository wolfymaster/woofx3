-- LuaCATS / EmmyLua annotations for the barkloader function `ctx`
-- object, consumable by sumneko-lua (the standard Lua language server)
-- and other LuaCATS-aware tooling.
--
-- Editor setup options:
--
-- 1. Workspace-wide: add this file's directory to your `.luarc.json`:
--      { "workspace": { "library": ["~/.lib/woofx3-module-sdk/lua"] } }
--    Pull the file with:
--      mkdir -p ~/.lib/woofx3-module-sdk/lua
--      cp node_modules/@woofx3/module-sdk/src/function-ctx.lua \
--         ~/.lib/woofx3-module-sdk/lua/
--
-- 2. Per-module: copy this file into your module repo at
--    `<module>/lua-stubs/function-ctx.lua` and point `.luarc.json`
--    at `lua-stubs/`. Keeps the type info close to the code.
--
-- Then annotate your function entry point:
--
--    ---@param ctx Ctx
--    local function increment(ctx)
--      local count = ctx.storage.get("count") or 0
--      ctx.storage.set("count", count + 1)
--    end
--
-- SOURCE OF TRUTH: this file mirrors the QuickJS adapter at
-- `barkloader/lib_sandbox/src/runtime/quickjs.rs:185-517` and the Lua
-- adapter at `barkloader/lib_sandbox/src/runtime/lua.rs:63-255`. Both
-- runtimes register an identical `ctx` shape, so this annotation is
-- valid for either.

---@meta

---@class ResourceInstance
---@field canonical_id string
---@field module_name string
---@field kind string
---@field instance_id string
---@field display_name string

---@class CtxHttpResponse
---@field status integer
---@field headers? table<string, string>
---@field body? any

---@class CtxHttpOptions
---@field headers? table<string, string>
---@field body? any
---@field query? table<string, string>

---@class CtxEvents
---@field publish fun(subject: string, data: any): nil

---@class CtxStorage
---@field get fun(key: string): any
---@field set fun(key: string, value: any): nil

---@class CtxHttp
---@field request fun(url: string, method: string, opts?: CtxHttpOptions): CtxHttpResponse

---@class CtxEnv
---@field get fun(key: string): string|nil

---Forwards to the host's log, prefixed with the calling module's id.
---There is no host-visible logging facility of Lua's own (the sandbox's
---StdLib is NONE); this is the only way to emit a log line. Strings are
---logged verbatim; any other value is JSON-encoded first.
---
---Takes exactly one argument. A second argument (e.g.
---`ctx.log.info("data", data)`) is silently dropped by the sandbox host
---binding, not logged and not an error — combine values yourself:
---`ctx.log.info({ label = "data", value = data })`.
---@class CtxLog
---@field info fun(value: any): nil
---@field warn fun(value: any): nil
---@field error fun(value: any): nil

---@class CtxResources
---@field create fun(kind: string, instance_id: string, display_name?: string): ResourceInstance
---@field delete fun(canonical_id: string): nil
---@field list fun(kind: string): ResourceInstance[]

---The standard shape a function returns when it wants the invoking chat
---command to reply. `proto`/`v` mirror the woofx3.widget/
---woofx3.overlay-events envelope convention, letting a caller reliably
---recognize a deliberate ctx.response() result versus any other table a
---function might return for its own purposes.
---@class CtxResponse
---@field proto "woofx3.response"
---@field v 1
---@field success boolean
---@field message string

---Identity and configured settings of the module the invoking function
---belongs to. `settings` has one key per `module_settings` row
---registered for this module, coerced to string/number/boolean based
---on each setting's declared type.
---@class CtxModule
---@field id string             manifest-local module id
---@field name string           display name from the manifest
---@field version string        semver string from the manifest
---@field settings table<string, string|number|boolean>

---@class CtxTwitchExtension
---@field clip fun(args?: any): nil
---@field timeout fun(args: any): nil
---@field updateStream fun(args: any): nil
---@field addModerator fun(args: any): nil

---@class CtxChatExtension
---@field sendMessage fun(text: string): nil

---@class CtxPlatformAlertsExtension
---@field alert fun(args: any): nil
---@field setTimer fun(args: any): nil

---@class CtxPlatformChatExtension
---@field register fun(args: any): nil

---@class CtxPlatform
---@field alerts? CtxPlatformAlertsExtension
---@field chat? CtxPlatformChatExtension

---The `ctx` object passed to every function invocation. Combines the
---built-in surface with extension namespaces the host registered. Each
---extension namespace is optional — check for presence before calling
---if your module is meant to run on multiple deployments.
---
---@class Ctx
---@field event any              the triggering CloudEvent's payload
---@field user any               user context attached by the host
---@field events CtxEvents
---@field storage CtxStorage
---@field http CtxHttp
---@field env CtxEnv
---@field resources CtxResources
---@field module CtxModule
---@field log CtxLog
---@field response fun(success: boolean, message: string): CtxResponse
---@field twitch? CtxTwitchExtension
---@field chat? CtxChatExtension
---@field platform? CtxPlatform
