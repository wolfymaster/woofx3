# Welcome to WoofX3 Documentation

WoofX3 is a unified streaming control plane consisting of various services that work together to provide a powerful streaming experience.

## Services

- **[Barkloader](/barkloader/)** - Rust-based module and plugin system that manages upload, manifest parsing, storage, and sandboxed execution of user-uploaded modules
- **[Workflow Engine](/workflow/)** - Event-driven workflow execution engine with triggers, conditional branching, event aggregation, and sub-workflows
- **[WoofWoofWoof](/woofwoofwoof/)** - A Twitch chatbot service that listens to messages, processes commands, and integrates with external services

## Cross-cutting

- **[Engine integrity](/services/engine-integrity)** - Modules request, the engine acts: module code never drives the bus directly
- **[Engine capabilities](/services/engine-capabilities)** - How the UI detects which features a connected engine supports, and the rule for adding capability ids
- **[CloudEvents](/services/cloudevents)** - Inter-service messaging format and the canonical NATS subject list
- **[Widget event channel](/services/widget-events)** - The unified `widget.event` channel and `widgetHost` API contract
- **[Widget storage](/services/widget-storage)** - Design: how an overlay widget reads and follows a module's stored values
- **[Asset delivery](/services/asset-delivery)** - How module and user assets reach the browser: URL shape, the sceneManager relay, and barkloader's presigned redirects
- **[Engine settings the UI configures](/services/engine-settings-ui)** - DB-backed settings (asset base URLs, etc.) surfaced through `getEngineInfo()` / `set*()` on `Woofx3EngineApi`
- **[Chat commands & groups: the UI contract](/services/commands-ui)** - Endpoints and webhook callbacks for managing chat commands and the user groups that gate them
- **[Twitch channel controls](/services/twitch-channel)** - The `twitchapi` commands (title, category, tags, markers, timeouts), what modules reach through `ctx.twitch`, and the chatbot's `!title`, `!category` and `!marker`
- **[Module settings: the UI contract](/services/module-settings-ui)** - Endpoints for reading and writing a module's engine-typed configuration values (`ctx.module.settings`)
- **[Config bundles](/services/config-bundles)** - Export, preview and import a creator's workflows, commands, groups and resource instances as one portable file
- **[Stream sessions](/services/stream-sessions)** - The logical span a broadcast belongs to: the partition key every event is stamped with
- **[OBS control](/services/obs)** - Connecting OBS, the workflow `obs.*` actions, and the `engine.obs.command` request/reply contract
- **[Analytics](/services/analytics)** - Design: turning stream events into per-session and lifetime totals, and why counters are not that

## Getting Started

Browse the documentation using the sidebar to learn about each service.
