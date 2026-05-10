# Welcome to WoofX3 Documentation

WoofX3 is a unified streaming control plane consisting of various services that work together to provide a powerful streaming experience.

## Services

- **[Barkloader](/barkloader/)** - Rust-based module and plugin system that manages upload, manifest parsing, storage, and sandboxed execution of user-uploaded modules
- **[Workflow Engine](/workflow/)** - Event-driven workflow execution engine with triggers, conditional branching, event aggregation, and sub-workflows
- **[Streamware](/streamware/)** - Overlay runtime: WebSocket transport to browser sources, alert queue, and the unified widget event channel
- **[WoofWoofWoof](/woofwoofwoof/)** - A Twitch chatbot service that listens to messages, processes commands, and integrates with external services

## Cross-cutting

- **[CloudEvents](/services/cloudevents)** - Inter-service messaging format and the canonical NATS subject list
- **[Widget event channel](/services/widget-events)** - The unified `widget.event` channel and `widgetHost` API contract

## Getting Started

Browse the documentation using the sidebar to learn about each service.
