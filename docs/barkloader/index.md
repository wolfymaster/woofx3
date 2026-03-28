# Barkloader (TypeScript)

::: warning Deprecated
This TypeScript barkloader is deprecated in favor of [Barkloader (Rust)](../barkloader-rust/), which provides module management, multi-runtime sandboxing, and a storage backend. This service will be removed in a future release.
:::

Lua script execution service built on Bun. Runs user-provided Lua scripts via Wasmoon (Lua compiled to WASM) and injects platform-specific globals that allow scripts to interact with Streamlabs, Twitch, and the command system over NATS.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3005` | WebSocket server port |
| `NATS_URL` | -- | NATS server connection URL |

## WebSocket Protocol

**Endpoint:** `ws://localhost:3005/`

### Invoke

**Client -> Server:**

```json
{
  "type": "invoke",
  "data": {
    "func": "myfunction",
    "args": ["arg1", "arg2"]
  }
}
```

The `func` field maps to a file at `lua/{func}.lua` on disk.

**Server -> Client (success):**

```json
{
  "error": false,
  "command": "write_message",
  "args": {
    "message": "return value from main()"
  }
}
```

**Server -> Client (error):**

```json
{
  "error": true,
  "message": "Error description",
  "received": "the original message"
}
```

## Lua Globals

Scripts have access to injected globals that publish messages to NATS as side effects.

### httpRequest(url, method, opts)

Make an HTTP request.

```lua
local response = httpRequest("https://api.example.com", "GET", { headers = {} })
```

### environment(key)

Read an environment variable.

```lua
local token = environment("API_TOKEN")
```

### stream_alert(args)

Send an alert to Streamlabs/OBS. Publishes to NATS subject `slobs`.

```lua
stream_alert({ audioUrl = "https://example.com/sound.mp3" })
```

### twitch(args)

Trigger a Twitch API command. Publishes to NATS subject `twitchapi`.

```lua
twitch({ time = "30s" })
```

### setTimer(args)

Set a countdown timer in Streamlabs. Publishes to NATS subject `slobs`.

```lua
setTimer({ id = "timer-1", valueInSeconds = "120" })
```

### setCommand(args)

Register a chat command in the database. Publishes to NATS subject `woofwoofwoof`.

```lua
setCommand({ name = "hello", response = "Hello, world!", type = "text" })
```

Command types: `text`, `function`, `func`.

## NATS Subjects

The TypeScript barkloader publishes to these subjects. It does not subscribe to any.

| Subject | Trigger | Payload |
|---------|---------|---------|
| `slobs` | `stream_alert()`, `setTimer()` | `{ command: "alert_message" \| "setTime", args: {...} }` |
| `twitchapi` | `twitch()` | `{ command: "clip", args: {...} }` |
| `woofwoofwoof` | `setCommand()` | `{ command: "add_command", args: {...} }` |
