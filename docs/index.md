# Welcome to WoofX3 Documentation

WoofX3 is a unified streaming control plane consisting of various services that work together to provide a powerful streaming experience.

## Services

- **[Barkloader](/barkloader/)** - Rust-based module and plugin system that manages upload, manifest parsing, storage, and sandboxed execution of user-uploaded modules
- **[Workflow Engine](/workflow/)** - Event-driven workflow execution engine with triggers, conditional branching, event aggregation, and sub-workflows
- **[Streamware](/streamware/)** - Overlay runtime: token-scoped browser-source serving, the P1/P2 widget protocols, the per-application event queue, and the unified widget event channel
- **[WoofWoofWoof](/woofwoofwoof/)** - A Twitch chatbot service that listens to messages, processes commands, and integrates with external services

## Cross-cutting

- **[CloudEvents](/services/cloudevents)** - Inter-service messaging format and the canonical NATS subject list
- **[Widget event channel](/services/widget-events)** - The unified `widget.event` channel and `widgetHost` API contract
- **[Engine settings the UI configures](/services/engine-settings-ui)** - DB-backed settings (asset base URLs, etc.) surfaced through `getEngineInfo()` / `set*()` on `Woofx3EngineApi`
- **[Chat commands & groups: the UI contract](/services/commands-ui)** - Endpoints and webhook callbacks for managing chat commands and the user groups that gate them
- **[Module settings: the UI contract](/services/module-settings-ui)** - Endpoints for reading and writing a module's engine-typed configuration values (`ctx.module.settings`)

## Getting Started

Browse the documentation using the sidebar to learn about each service.
