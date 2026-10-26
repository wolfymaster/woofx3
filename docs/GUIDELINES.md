# Documentation Guidelines

The docs are hand-written Markdown rendered by VitePress. `docs/index.md` is the entry point; each section lives in its own directory (`workflow/`, `barkloader/`, `services/`, `operations/`).

## Writing

- Describe how the system works today, not what is planned for it.
- Put each page under the section it belongs to and link it from `docs/index.md` or the section's index.
- VitePress generates heading anchors, so cross-reference with `[Commands class](#commands)` or `[Commands.add()](#commandsadd)`.

## Checking

```bash
cd docs && bun run docs:build     # Static site build; fails on dead links
cd docs && bun run docs           # Dev server
cd docs && bun run docs:preview   # Preview the built site
```
