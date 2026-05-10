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
-- `barkloader/lib_sandbox/src/runtime/quickjs.rs:185-417` and the Lua
-- adapter at `barkloader/lib_sandbox/src/runtime/lua.rs:63-192`. Both
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

---@class CtxResources
---@field create fun(kind: string, instance_id: string, display_name?: string): ResourceInstance
---@field delete fun(canonical_id: string): nil
---@field list fun(kind: string): ResourceInstance[]

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
---@field twitch? CtxTwitchExtension
---@field chat? CtxChatExtension
---@field platform? CtxPlatform
