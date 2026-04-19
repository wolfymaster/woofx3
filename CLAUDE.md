# About this project
This is a mono repopository consisting of various services that together are known as woofx3, a unified straming control plane.
Woofx3 consists of the following tools:
- A rust-based module/plugin system that allows users to upload modules containing a manifest and custom code, workflows, and assets that extend functionality of the system.
- A database proxy service that generates grpc clients that other services use. No service has direct access to any data store except the db proxy. DB proxy has two types of databases.
    - Postgres/Sqlite - this is the woofx3 system database used for system-wide data
    - BadgerDB - this is a key/value datastore that is available for modules to utilize. Since modules are provided by end-users, this extends a persistant layer to modules
- Permissions embeded in db proxy that can allow/deny user access
- Shared clients and libraries that are used across multiple services are kept in the 'shared' directory
- Integration with OBS and Streamlabs
- Rules engine and evaluation based on the Rete algorithm. This evaluates the world as a collection of 'facts' and 'requirements' Actions/neurons have requirements and are triggered if the required facts are present.
- Twitch integration with the EventBus
- Twitch chatbot
- Workflow engine lite. Inspired by Cadence/Temporal, this service attempts to keep an API similiar to temporal, providing both code-defined workflows as well as dynamic workflows provided by json or yaml configuration. Workflows have Triggers and Steps (Tasks) that run until completion. 

# Documentation (architecture and design)

Subsystem behavior, public APIs, module formats, and workflow design are documented under **`docs/`** as a **VitePress** site (see `docs/package.json`). Use it together with this file when you need service-level depth beyond the mono-repo overview.

- **Entry:** `docs/index.md`
- **Major sections:** `docs/workflow/` (engine schema, execution, API), `docs/barkloader/` (modules, sandbox, API), `docs/woofwoofwoof/` (application and services), `docs/services/` (shared runtime, CloudEvents)

```bash
cd docs && bun run docs           # VitePress dev
cd docs && bun run docs:build     # Static site build
```

Optional codegen used by that site: `bun run docs:generate` from `docs/` (see `docs/package.json`).

# Dependencies
This project must run locally when compiled and cannot depend on third-party services. This requires a lot of 'from scratch' development. Libraries that can be included in the compiled binary are allowed. The major targeted platforms are windows and linux.

# Development
This project uses Devbox (https://www.jetify.com/devbox). The project includes a `devbox.json` that pins toolchains for Bun, Go, Rust, and various CLI tools. All commands must be run in a devbox shell which ensures (using nix) that all dependencies and correct versions are installed.

```bash
devbox shell  # Enter the devbox shell with all dependencies available
```

This project makes heavy use of Typescript (Bun), Rust, and Golang. Core services are written in Rust or Golang for performance. Some services may be called hundreds of times per second. Typescript is used on 'edge' services and at integration points.

### Running, building, and linting

- **TypeScript/Bun projects** (e.g., `streamlabs/`): Run `bun run <script>` or `bun run typecheck` / `bun run lint`
- **Go projects** (e.g., `wooflow/`): Run `go run main.go` or `go build`
- **Rust projects** (e.g., `barkloader/`): Run `cargo build` / `cargo test`
- **Database migrations**: Use `make migrate-up` / `make migrate-down` (requires Go) 

### Generating protobuf code

The db module uses **Buf** for protobuf code generation. When adding or modifying proto files, regenerate the Go and TypeScript clients:

```bash
cd db && npm run generate    # Generates both Go and TypeScript clients
# Or individually:
npm run generate:go          # Generate Go (Twirp + Protobuf)
npm run generate:ts          # Generate TypeScript
```

Always rebuild after regenerating proto code to catch any compile errors:

```bash
cd db && go build ./...
cd ../barkloader && cargo build
```

### Client consistency

Clients exist in **three languages**: TypeScript, Go, and Rust. Some are generated from proto files (db module), while others are written by hand (barkloader). When modifying client APIs, ensure consistency across all three implementations:

- **Generated clients** (`shared/clients/{typescript,golang,rust}/db/`): Regenerate via `npm run generate` in `db/`
- **Hand-written clients**: Manually update all three language versions to match

Common hand-written clients:
- `shared/clients/typescript/barkloader/index.ts`
- `shared/clients/golang/barkloader/client.go`
- (Rust uses the barkloader server directly)

### Configuration

All services share a common `.woofx3.json` configuration file at the repo root. The TypeScript,
Go, and Rust runtimes all support loading this file with the same precedence:

1. **Environment variables** (highest priority) - e.g., `WOOFX3_BARKLOADER_KEY`
2. **`./.env` file** - key=value pairs
3. **`./.woofx3.json` file** (lowest priority) - JSON with camelCase keys

To locate the config, services search parent directories from current working directory until
they find `.woofx3.json` (or `.woofx3.config`), or reach the filesystem root.

Rust services using the shared config module (`shared/common/rust/runtime`):
```rust
use woofx3_runtime::Config;

// Load config from .woofx3.json (walks up to find file)
let config = Config::load()?;

// Get value - checks WOOFX3_* env first, then config file
let value = config.get("applicationId");
```

Required config validation should fail fast at startup:
```rust
use crate::util::validate_required_config;

if let Err(e) = validate_required_config(&["WOOFX3_BARKLOADER_KEY", "APPLICATION_ID"]) {
    log::error!("{}", e);
    std::process::exit(1);
}
```

# Git commits

- **Never add a Co-Authored-By line** for AI agents or assistants. All credit belongs to the human author.

# Code style and programming principles

Write for senior engineers: **homogeneous** patterns, naming, and formatting across the repo. **Do not use emojis in comments** (they can break tooling).

- **Tiger Style** ([tigerstyle.dev](https://tigerstyle.dev/)): fail fast; use assertions and invariants so the program does not continue in an undesirable or inconsistent state.
- **Explicit over implicit**: prefer clear names, types, and boundaries over magic, inference-only APIs, or hidden side effects.
- **Comments**: use sparingly; reserve them for non-obvious rationale, invariants, or genuinely complex logic. Prefer self-documenting names and structure.
- **Optimize for the reader**: clarity and straightforward flow beat cleverness.
- **Block bodies everywhere**: use braces (or the language’s required block form) for **all** branches and loop bodies—no single-line `if`/`for`/`while` without braces where the grammar allows blocks.
- **Composition over inheritance**: prefer small units composed together; use interfaces, traits, and protocols so behavior combines cleanly.
- **Proven patterns**: use reliable, industry-standard design patterns and architectures when they fit the problem; avoid novelty for its own sake.
- **Less code, more foresight**: the best code is often code you do not write—design boundaries and abstractions that stay stable as requirements shift.
- **Iterate with confidence**: if an implementation feels wrong, reconsider it; **git** is there to commit or branch, try an alternative, and compare.
- **Tests before piling on**: after substantive changes, run the relevant test suites and keep them passing before layering new features.
- **Have fun**: the best code often comes from room to be creative and express yourself—clarity and play are not opposites.

# Architecture

- MicroServices
- Communication is done via events over the message bus. The message bus follows the NATS interface, uses the NATS client, but operates locally. Events are formatted according to the CloudEvents specification (https://github.com/cloudevents/spec).
- Shared clients and packages to keep types and events consistent between services. ie: shared/clients/cloudevents contains events in cloudevents format. 
- Only DB communicates with databases. All services use GRPC clients to communicate with the db proxy.

# Backlog

The project backlog is tracked in Notion in the **Backlog** database (ID: `272a5cd7-e93c-80ee-8420-e30b81942b08`), located under the Twitch workspace.

**How to query it:**
1. Use `mcp__notion__API-post-search` with `query: "Backlog"` and `filter: {"property": "object", "value": "data_source"}` to find the database.
2. Use `mcp__notion__API-post-search` with `filter: {"property": "object", "value": "page"}` and filter results client-side by `parent.database_id == "272a5cd7-e93c-80ee-8420-e30b81942b08"`.
3. Each page has properties: **Name** (title), **Status** (Not started / In progress / Done), **Project**, **Epic**, **Language**.

**Important notes:**
- UI and Website project tasks are **not** in this repository -- they live in a separate codebase. Filter them out when looking for work to do here.
- Projects that map to this repo: API, Barkloader, Db, Module, Shared, Wooflow, WoofWoofWoof, Treats, Twitch, Tauri.
- When picking up a task, update its Status to "In progress" in Notion.
- When completing a task, update its Status to "Done" in Notion.