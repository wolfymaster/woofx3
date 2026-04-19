# Agent guidance (woofx3)

Orientation for automated coding agents in the **woofx3** mono-repository (streaming control plane: modules, db proxy, workflow engine, Twitch/chat, Rete rules, etc.). **Full overview:** **`CLAUDE.md`**.

## Documentation (architecture and design)

Subsystem APIs, workflow schema, barkloader/module format, and service layout are documented under **`docs/`** as **VitePress** (`docs/package.json`).

- Entry: `docs/index.md`
- Areas: `docs/workflow/`, `docs/barkloader/`, `docs/woofwoofwoof/`, `docs/services/`

```bash
cd docs && bun run docs
cd docs && bun run docs:build
```

Optional: `cd docs && bun run docs:generate` (see `docs/package.json`).

## Dependencies and targets

Must run **fully locally** — no required third-party SaaS at compile/runtime for the core stack. **Windows and Linux** are primary targets.

## Development environment

Use **Devbox** ([devbox](https://www.jetify.com/devbox)) to set up a shell with all required dependencies. The project includes a `devbox.json` that pins toolchains for Bun, Go, Rust, and various CLI tools.

```bash
devbox shell  # Enter the devbox shell with all dependencies available
```

Languages: **TypeScript (Bun)** on edges/integrations; **Rust** and **Go** for hot paths and core services.

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
cd db && go build ./...           # Verify Go build
cd ../barkloader && cargo build  # Verify Rust build
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
let value = config.get("barkloaderKey");
```

Required config validation should fail fast at startup:
```rust
use crate::util::validate_required_config;

if let Err(e) = validate_required_config(&["WOOFX3_BARKLOADER_KEY"]) {
    log::error!("{}", e);
    std::process::exit(1);
}
```

Note: `applicationId` is **not** a config value. It is created during UI onboarding
via `api.registerClient(description, { userId })` and returned to the caller; services
either carry it per-message (e.g. `api`, `barkloader`) or let the db-proxy resolve the
server-side default when it is absent. Do not add it back to `.woofx3.json` or env.

## Git commits

- **Never add a Co-Authored-By line** for AI agents or assistants. All credit belongs to the human author.

## Code style and programming principles

- Readable, **homogeneous** patterns across the repo. **No emojis in comments** (can break tooling).
- **Tiger Style** ([tigerstyle.dev](https://tigerstyle.dev/)): fail fast; assert invariants; do not continue in an inconsistent or undesirable state.
- **Explicit over implicit** (names, types, API boundaries).
- **Sparse comments** — only for non-obvious rationale or complex logic; prefer self-documenting code.
- **Optimize for the reader**; clarity over cleverness.
- **Braces / block bodies** on all branches and loop bodies where the language allows (no brace-less `if`/`for`/`while` one-liners).
- **Composition over inheritance**; use interfaces, traits, and protocols to compose behavior.
- **Established patterns** when they fit; avoid novelty without reason.
- **Design for change** — prefer boundaries and abstractions that age well; minimize unnecessary code.
- **Second-guess bad fits**; use **git** (commits/branches) to try alternatives.
- **Run tests** for touched areas and keep them **green** before stacking new features.
- **Have fun**: creativity and expression produce strong code when paired with discipline above.

Details: **`CLAUDE.md`** (same principles, expanded).

## Architecture (non-negotiables)

- **Microservices** communicating over a **message bus** (NATS client API, local deployment).
- Events follow **CloudEvents** (`shared/clients/cloudevents` and related).
- **Only the DB layer** talks to databases. Other services use **gRPC clients** to the **db proxy** (Postgres/Sqlite system DB; BadgerDB for module KV).

## Related repository

The multi-tenant **SaaS control plane UI** (Convex + React) is **`woofx3-ui`** — separate repo; it registers engine instances and proxies HTTP to engines. Engine code and contracts for modules/workflows live here.

## When in doubt

Read **`CLAUDE.md`** for the canonical bullet list of components (db proxy, barkloader, workflow lite, Twitch, etc.) and documentation entry points.
