# WoofX3

**Unified Streaming Control Plane. Everything you need to stream.**

Chatbot, alerts, integrations, overlays, and the automation that ties them
together — all in one platform, running locally on your own machine, with
full control over your data. Built for creators who demand more from their
tools, and who are tired of juggling half a dozen of them that don't talk to
each other.

> Marketing site and waitlist: **[woofx3.tv](https://woofx3.tv)**

## Table of Contents

- [What WoofX3 Does](#what-woofx3-does)
- [Architecture at a Glance](#architecture-at-a-glance)
- [Services](#services)
  - [Public Surface](#public-surface)
  - [Platform Core](#platform-core)
  - [Integrations](#integrations)
  - [Modules and Extensibility](#modules-and-extensibility)
  - [Shared Libraries](#shared-libraries)
- [Module System (Barkloader)](#module-system-barkloader)
  - [What a Module Can Contribute](#what-a-module-can-contribute)
  - [Bundle Layout](#bundle-layout)
  - [Sandboxed Runtimes](#sandboxed-runtimes)
  - [Lifecycle: Upload, Register, Invoke](#lifecycle-upload-register-invoke)
  - [How Modules Connect to the Rest of WoofX3](#how-modules-connect-to-the-rest-of-woofx3)
  - [Where to Go Next](#where-to-go-next)
- [Repository Layout](#repository-layout)
- [Tech Stack](#tech-stack)
- [Documentation](#documentation)
- [Project Conventions](#project-conventions)
- [License](#license)

## What WoofX3 Does

If you've ever spent the first thirty minutes of a stream poking at a chatbot
setting, debugging an alert that won't fire, and praying the overlay didn't
break since last week — that's the problem WoofX3 exists to solve.

WoofX3 brings simplicity back to streaming by unifying every part of your
setup — chatbot, alerts, integrations, overlays, and the automation that
links them — into a single platform that's actually designed to work
together. Less time managing technology, more time creating content.

### Built for Modern Streamers

- **One platform, zero complexity.** Chatbot, alerts, integrations, overlays,
  and automation all live in the same system and stay in sync automatically.
  No more "tool A doesn't know what tool B just did," no more pasting
  together five dashboards to make one stream work.
- **Yours, on your machine.** WoofX3 is downloaded and run locally. Your
  data, your logins, your chat history — they don't leave your computer
  unless you choose to send them somewhere. No subscription, no surprise
  pricing tier, no outage on someone else's servers taking your stream down.
- **Built for 24/7 streaming.** Designed to run quietly in the background —
  through long sessions, restarts, and the unpredictable shape of live
  content. Built to keep up while you focus on the stream.
- **Setup in minutes, not hours.** Smart defaults out of the box. The
  settings that are there are the settings that actually matter — no rabbit
  holes.
- **Scale from beginner to pro without switching platforms.** Start with the
  built-ins; reach for plugins, automations, and custom integrations when you
  outgrow them. Same install, same interface, no migration.

### What's in the Box

- **Chatbot** — Twitch chat with custom commands, viewer roles (mods, VIPs,
  subs, regulars), and as much smarts behind those commands as you want —
  from one-liners to multi-step routines.
- **Alerts and overlays** — widgets and full-screen overlays you drop into
  OBS, driven by the same activity that runs your chatbot. They stay in sync
  automatically; no more "why didn't the alert fire?"
- **Integrations** — deep Twitch integration covering chat, follows, subs,
  raids, redemptions, and the rest of the channel events you actually care
  about, plus OBS scene control, with a clean way to plug in everything
  else you use.
- **Automations** — build "when X happens, do Y, then Z" routines without
  writing code. Start with simple chains, work up to multi-step routines
  that branch on conditions, react to bursts of activity, or call into
  other routines you've already built.
- **Plugins** — drop in a plugin and the platform picks up whatever it
  brings: new chat commands, new alerts, new overlays, new automation
  hooks. Install one someone else built, or write your own. See
  [Module System (Barkloader)](#module-system-barkloader) for the developer
  view.

### Why Creators Choose It

WoofX3 isn't trying to be the simplest possible chatbot or the simplest
possible alert tool — it's trying to be the *only* platform you need, while
still getting out of your way. If you've outgrown the patchwork of
subscriptions, browser extensions, and one-off scripts that most stream
setups eventually become — and the last thing you want is to spend your
off-stream hours being your own IT department — this is built for you.

---

> **About this repository.** What follows is the engineering view of WoofX3
> — the monorepo of services that together implement the platform described
> above. If you're a streamer evaluating WoofX3, [woofx3.tv](https://woofx3.tv)
> is the right starting point. If you're a developer, contributor, or modder,
> read on.

## Architecture at a Glance

WoofX3 is built around six engineering principles:

- **Local-first.** Everything compiles to binaries that run on the streamer's
  machine. No required SaaS dependencies (targets: Windows and Linux).
- **Event-driven.** Services communicate exclusively over a local NATS bus
  using [CloudEvents 1.0](https://github.com/cloudevents/spec).
- **Single data plane.** A dedicated database proxy (`db`) is the only
  process that touches Postgres / SQLite / BadgerDB; every other service uses
  a generated Twirp client.
- **Extensible.** Modules are sandboxed bundles (Lua + QuickJS) that ship
  triggers, actions, workflows, widgets, and overlays — see
  [Module System](#module-system-barkloader).
- **Workflow-native.** A lightweight workflow engine (inspired by
  Cadence/Temporal) runs both code-defined and JSON/YAML-defined workflows.
- **Rules-aware.** A Rete-based rules engine evaluates the world as
  facts and requirements so actions fire only when their preconditions are met.

```
            ┌────────────────────────────────────────────────────────┐
            │           Clients (UI, Tauri shell, OBS, browsers)      │
            └──────────────────────────┬─────────────────────────────┘
                                       │  Cap'n Web RPC (HTTP / WS)
                                       ▼
            ┌────────────────────────────────────────────────────────┐
            │                          api                            │
            │              public RPC gateway service                 │
            └──────────────────────────┬─────────────────────────────┘
                                       │
            ┌──────────────────────────┴─────────────────────────────┐
            │       NATS message bus  ·  CloudEvents 1.0 envelopes    │
            └──┬──────────────┬──────────────┬──────────────┬────────┘
               │              │              │              │
               ▼              ▼              ▼              ▼
         ┌──────────┐  ┌────────────┐  ┌─────────────┐  ┌──────────────┐
         │  twitch  │  │  workflow  │  │  barkloader │  │ woofwoofwoof │
         │  Helix + │  │   engine + │  │   modules + │  │   Twitch     │
         │  EventSub│  │ rete rules │  │  Lua/QJS sbx│  │   chatbot    │
         └────┬─────┘  └─────┬──────┘  └──────┬──────┘  └──────┬───────┘
              │              │                │                │
              └──────────────┴────────┬───────┴────────────────┘
                                      │ Twirp (gRPC)
                                      ▼
                       ┌──────────────────────────────┐
                       │              db               │
                       │   Postgres / SQLite + Badger  │
                       │   permissions · module KV     │
                       └──────────────────────────────┘
```

Two communication planes: **events** (NATS, fire-and-forget) and **data**
(Twirp into `db`). External integrations such as Twitch EventSub or OBS are
adapted at the edges and republished onto the bus as CloudEvents.

## Services

### Public Surface

| Service | Path | Language | Role |
| ------- | ---- | -------- | ---- |
| **api** | [`api/`](api) | TypeScript (Bun) | Cap'n Web RPC gateway over HTTP and WebSocket. Translates client calls into Twirp requests against `db` and CloudEvent publishes onto the bus. See [`api/README.md`](api/README.md). |

### Platform Core

| Service | Path | Language | Role |
| ------- | ---- | -------- | ---- |
| **db** | [`db/`](db) | Go | Database proxy. Owns Postgres/SQLite for system data and BadgerDB for module key/value storage. Enforces permissions. Exposes Twirp services generated from protobuf. |
| **workflow** | [`workflow/`](workflow) | Go | Event-driven workflow engine with triggers, conditional branching, event aggregation, sub-workflows, and Rete-based rules. Docs: [`docs/workflow/`](docs/workflow/index.md). |
| **services/nats** | [`services/nats/`](services/nats) | Go | Embedded local NATS server that backs the message bus during development and self-hosted deployments. |

### Integrations

| Service | Path | Language | Role |
| ------- | ---- | -------- | ---- |
| **twitch** | [`twitch/`](twitch) | TypeScript (Bun) | Twitch Helix API + EventSub WebSocket bridge. Republishes Twitch events as CloudEvents and dispatches API call results back onto the bus as new commands. |
| **woofwoofwoof** | [`woofwoofwoof/`](woofwoofwoof) | TypeScript (Bun) | Twitch chatbot. Listens to chat, processes commands, and integrates with external services and modules. Docs: [`docs/woofwoofwoof/`](docs/woofwoofwoof/index.md). |
| **streamlabs** | [`streamlabs/`](streamlabs) | TypeScript (Remix) | Browser-source overlays, alerts, and chat widgets. Integrates with OBS via the OBS WebSocket. |
| **reward** | [`reward/`](reward) | TypeScript (Bun) | Viewer rewards subsystem (early sketch — see [`reward/README.md`](reward/README.md) for the rules-engine design notes). |
| **treats** | [`treats/`](treats) | _planned_ | Viewer-engagement currency / treats system. Not yet implemented. |
| **irl/srt-live-server** | [`irl/srt-live-server/`](irl/srt-live-server) | C++ (vendored) | SRT relay used for IRL streaming setups. |

### Modules and Extensibility

| System | Path | Language | Role |
| ------ | ---- | -------- | ---- |
| **barkloader** | [`barkloader/`](barkloader) | Rust | Module / plugin runtime. Accepts user-uploaded module bundles (manifest + code + workflows + assets) and executes them inside sandboxed Lua and QuickJS interpreters. See [Module System](#module-system-barkloader) below for the full picture, or [`docs/barkloader/`](docs/barkloader/index.md) for reference docs. |

### Shared Libraries

The `shared/` tree hosts code consumed by multiple services. Generated Twirp
clients live next to hand-written clients; both follow the same three-language
layout.

| Path | Purpose |
| ---- | ------- |
| [`shared/clients/{golang,rust,typescript}/db/`](shared/clients) | Generated Twirp/Protobuf clients for `db`. |
| [`shared/clients/{golang,rust,typescript}/barkloader/`](shared/clients) | Hand-written clients for the `barkloader` HTTP API. |
| [`shared/common/{golang,rust,typescript}/cloudevents/`](shared/common) | Typed CloudEvent factories and event definitions. See [`docs/services/cloudevents.md`](docs/services/cloudevents.md). |
| [`shared/common/{golang,rust,typescript}/runtime/`](shared/common) | Shared service lifecycle, config loading, and health-monitoring scaffolding. See [`docs/services/runtime.md`](docs/services/runtime.md). |

## Module System (Barkloader)

Barkloader is the extension layer of WoofX3 — the seam through which
streamers, third parties, and the core team itself ship behavior into the
platform without forking it. A module is a self-contained ZIP bundle
(manifest + sandboxed scripts + bundled workflows + widget HTML + overlay
assets) installed at runtime over an HTTP API and executed on demand over
WebSocket. Even much of the "built-in" Twitch behavior is delivered as a
module ([`barkloader/modules/twitch_platform/`](barkloader/modules/twitch_platform)).

The full reference lives under [`docs/barkloader/`](docs/barkloader/index.md);
this section is the orientation.

### What a Module Can Contribute

A single module's manifest may declare any combination of the following.
Sections are independent — a module can ship _only_ triggers, _only_ widgets,
or any mix.

| Section | Purpose |
| ------- | ------- |
| **`triggers`** | Bus event sources (e.g., `twitch.channel.subscribe`) that workflows and other modules can subscribe to. Each trigger has an id, type (`eventbus`, `webhook`, `command`, `schedule`, …), and an optional payload `schema`. |
| **`functions`** | Lua or JavaScript handlers callable by id. Resolved by the path `module_id/function_id` over WebSocket. |
| **`actions`** | Workflow-step actions that resolve to either a built-in or a function call (`call: "#func handler_id"`). |
| **`workflows`** | Bundled workflows (trigger + steps) that ship with the module and run on the workflow engine. |
| **`commands`** | Chat commands matched by `prefix` / `exact` / `regex` and routed to a workflow or function, optionally gated by `requiredRole`. |
| **`widgets`** | Browser-source UI snippets with a `settingsSchema` for the host UI and a list of `acceptedEvents` they subscribe to. |
| **`overlays`** | Full-screen browser-source HTML for OBS. |

Only `id` and `name` are required at the top level. Anything referenced by a
manifest path is uploaded as-is — non-program files are stored as raw bytes,
so binary assets (images, fonts, audio) work without ceremony.

### Bundle Layout

```
my-module.zip
├── module.json                 # required at ZIP root (or module.yaml)
├── functions/
│   └── play_alert.lua
├── widgets/
│   └── alerts/
│       ├── index.html
│       └── static/style.css
└── overlays/
    └── main/index.html
```

A minimal manifest:

```json
{
  "id": "my-module",
  "name": "My Module",
  "version": "1.0.0",
  "triggers": [
    { "id": "twitch.channel.subscribe", "name": "Subscribe", "type": "eventbus" }
  ],
  "functions": [
    { "id": "play_alert", "name": "Play Alert", "runtime": "lua", "path": "functions/play_alert.lua" }
  ],
  "workflows": [
    {
      "id": "on_sub",
      "name": "On Sub",
      "trigger": "twitch.channel.subscribe",
      "steps": [{ "action": "#func play_alert", "params": {} }]
    }
  ]
}
```

Full schema in [`docs/barkloader/modules.md`](docs/barkloader/modules.md).
Manifest keys are camelCase JSON; YAML works equivalently.

### Sandboxed Runtimes

Module code runs **in-process** but inside a **deny-by-default sandbox** — no
filesystem, no network, no host-language stdlib leakage. Each WebSocket
connection gets its own `Sandbox`; all sandboxes share an in-memory
`ModuleRegistry` (RwLock) holding the currently loaded modules.

| Runtime | Extension | Stdlib | Notes |
| ------- | --------- | ------ | ----- |
| **Lua 5.4** (via `mlua`) | `.lua` | `StdLib::NONE` | No `io`, `os`, `require`, or `dofile`. Only the core language: tables, strings, math, coroutines. |
| **JavaScript** (via QuickJS) | `.js` | none | No Node/Bun APIs, no `fs`, no `fetch`, no DOM. Pure ECMAScript. |

Every program file must define a `main(args)` entry point. The `args` value
from the WebSocket invoke message is forwarded as-is, and the return value is
JSON-serialized back to the caller.

```lua
function main(args)
  return { greeting = "hello, " .. args.name }
end
```

```javascript
function main(args) {
  return { greeting: "hello, " + args.name };
}
```

Each function carries an `is_trusted` flag set during loading; runtime
adapters can use it to gate access to additional host APIs in the future.

### Lifecycle: Upload, Register, Invoke

The lifecycle is intentionally split so artifact storage and execution
registration are independent operations, and so a module's presence on disk
survives across restarts.

```
1. Upload    POST /functions   (multipart ZIP)
                ├─ extract → parse manifest → write modules/{id}/...
                ├─ archive original to archives/{id}/{version}.zip
                └─ if DB_PROXY_ADDR: Twirp CreateModule + RegisterTrigger per trigger

2. Register  POST /functions/{id}/register
                └─ scan modules/{id}/**/*.{lua,js} → ModuleRegistry.register

3. Invoke    ws://.../ws  →  { "type":"invoke",
                              "data":{ "function":"{id}/{fn}", "args":{...} } }
                └─ ModuleRegistry.get_function → adapter.execute → JSON result
```

At startup, barkloader rescans the repository and re-registers every module
it finds. Modules can be enabled/disabled without removal
(`PATCH /functions/{name}/state`) and rolled back to any previously archived
version (`POST /functions/{name}/rollback?version=...`).

The repository backend is pluggable: local filesystem by default,
S3-compatible (MinIO/LocalStack) when `REPOSITORY_TYPE=s3`. Full HTTP and
WebSocket reference: [`docs/barkloader/api.md`](docs/barkloader/api.md).

### How Modules Connect to the Rest of WoofX3

Barkloader is the runtime, but a module touches several other services:

| Concern | How it lands in the system |
| ------- | -------------------------- |
| **Trigger declared** | `db` records it via Twirp `RegisterTrigger`; the workflow engine subscribes to the matching bus subject and routes events to bundled or downstream workflows. |
| **Workflow step calls a function** | The workflow engine resolves the `#func` action to a barkloader WebSocket invoke (`module/function`) and forwards args. |
| **Chat command matches** | `woofwoofwoof` matches the message against the module's `commands[]` and routes to either a workflow or a function invoke. |
| **Widget / overlay loads** | Stored under `modules/{id}/widgets/...` or `overlays/...` and served as a browser source in OBS; widgets subscribe to their declared `acceptedEvents` over the bus. |
| **Module needs persistence** | A separate in-process `StorageClient` (gRPC to the `db` proxy's BadgerDB store) is exposed to modules. Keys are not pre-declared in the manifest — modules write to the KV namespace at runtime. |

A few manifest sections — `actions`, `commands`, and `workflows` — are
parsed and logged at install time today but not yet pushed end-to-end into
the command and workflow services. `triggers` _are_ persisted via Twirp when
a DB proxy URL is configured.

### Where to Go Next

- **[Module Format](docs/barkloader/modules.md)** — every manifest field, supported file types, and the full processing pipeline.
- **[Sandbox & Runtimes](docs/barkloader/sandbox.md)** — adapter contracts, error categories, JSON ↔ Lua / JS type mappings.
- **[Barkloader API](docs/barkloader/api.md)** — full HTTP and WebSocket protocol reference.
- **Example module** — [`barkloader/modules/twitch_platform/`](barkloader/modules/twitch_platform) ships Twitch EventSub subscription types as triggers, end to end.

## Repository Layout

```
woofx3/
├── api/             Public Cap'n Web RPC gateway (TS / Bun)
├── barkloader/      Module runtime + Lua/QuickJS sandboxes (Rust)
├── db/              Database proxy, protobuf, migrations (Go)
├── workflow/        Event-driven workflow engine (Go)
├── twitch/          Twitch Helix + EventSub bridge (TS / Bun)
├── woofwoofwoof/    Twitch chatbot (TS / Bun)
├── streamlabs/      Browser-source overlays and widgets (Remix)
├── reward/          Viewer rewards subsystem (TS / Bun, early)
├── treats/          Viewer treats system (planned)
├── services/
│   └── nats/        Local NATS message bus
├── shared/
│   ├── clients/     Per-language clients for db and barkloader
│   └── common/      CloudEvents, runtime, and other shared code
├── irl/             IRL streaming utilities (SRT live server)
├── infra/           Docker, Coder, GPU and other infra configs
├── docs/            VitePress documentation site
├── devbox.json      Pinned toolchains (Bun, Go, Rust, CLIs)
├── process-compose.yml   Local multi-service orchestration
└── .woofx3.json     Shared runtime configuration (when present)
```

## Tech Stack

- **Languages.** TypeScript (Bun) for edge and integration services, Go for
  performance-sensitive core services and the workflow engine, Rust for the
  module runtime, Lua and QuickJS for sandboxed user modules.
- **RPC and serialization.** Twirp + Protobuf between services and `db`,
  Cap'n Web at the public API edge, CloudEvents 1.0 over NATS for the
  message bus.
- **Storage.** Postgres or SQLite (system data) and BadgerDB (module
  key/value) — both behind the `db` proxy.
- **Tooling.** [Devbox](https://www.jetify.com/devbox) pins toolchains via
  Nix. Local multi-service runs use
  [process-compose](https://github.com/F1bonacc1/process-compose) (see
  `process-compose.yml`).

## Documentation

The architecture, public APIs, module format, and workflow design are
documented as a VitePress site under [`docs/`](docs/). Start at
[`docs/index.md`](docs/index.md) and use the sidebar.

Direct entry points by topic:

- **Workflow engine** — [`docs/workflow/`](docs/workflow/index.md)
  ([schema](docs/workflow/schema.md) ·
  [execution](docs/workflow/execution.md) ·
  [tasks](docs/workflow/tasks.md) ·
  [API](docs/workflow/api.md) ·
  [examples](docs/workflow/examples.md))
- **Barkloader** — [`docs/barkloader/`](docs/barkloader/index.md)
  ([modules](docs/barkloader/modules.md) ·
  [sandbox](docs/barkloader/sandbox.md) ·
  [API](docs/barkloader/api.md))
- **WoofWoofWoof** — [`docs/woofwoofwoof/`](docs/woofwoofwoof/index.md)
  ([application](docs/woofwoofwoof/application.md) ·
  [commands](docs/woofwoofwoof/commands.md) ·
  [Twitch chat](docs/woofwoofwoof/twitchChat.md) ·
  [message bus](docs/woofwoofwoof/messageBus.md) ·
  [config](docs/woofwoofwoof/config.md))
- **Shared services** — [CloudEvents](docs/services/cloudevents.md) ·
  [Runtime](docs/services/runtime.md)

To run the docs site locally:

```bash
cd docs && bun run docs        # VitePress dev server
cd docs && bun run docs:build  # Static site build
```

## Project Conventions

- **Code style.** [Tiger Style](https://tigerstyle.dev/) — fail fast, assert
  invariants, prefer explicit over implicit. Block bodies on every branch and
  loop. Comments are reserved for non-obvious rationale.
- **Communication.** Services exchange CloudEvents over NATS. Only `db` may
  touch a database; all other services use generated Twirp clients.
- **Three-language clients.** Generated `db` clients exist for Go, Rust, and
  TypeScript and are regenerated from `db/proto/` via `npm run generate` in
  `db/`. Hand-written clients (barkloader) must be kept in sync across all
  three languages.
- **Configuration.** A shared `.woofx3.json` at the repo root, overridden by
  `.env` and then by environment variables. See `CLAUDE.md` for the full
  precedence rules and validation patterns.

## License

WoofX3 is distributed under the **Business Source License 1.1** with a Change
Date of **2030-04-25** and a Change License of the **Mozilla Public License,
Version 2.0**. Each released version of WoofX3 is licensed under the BSL with
a Change Date set four years after that version's first publicly available
distribution; on its Change Date the version automatically converts to MPL
2.0.

**You may run WoofX3 yourself.** As an individual you may host your own
instance for your own use — including for your own commercial streaming or
content-creation activities — and a single household may share one instance
among its members. This grant is per-individual, not per-organization: a
separate commercial license is required to (a) run a shared WoofX3 instance
on behalf of multiple end users within a company, organization, agency,
multi-streamer house, talent network, or other multi-user group, or (b)
offer WoofX3 (or any substantially-derived work) to third parties as a
hosted, managed, or "as-a-service" product. Contact the Licensor for
commercial terms.

The full license text is in [`LICENSE.md`](LICENSE.md). For commercial
licensing inquiries, contact the Licensor at `wolfy@wolfymaster.com`.
