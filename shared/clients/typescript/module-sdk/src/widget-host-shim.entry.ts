// Classic-script entry point for the widget-host shim. Built by
// `bun run build:shim` into `dist/widget-host-shim.js` — a
// self-contained IIFE with no ESM, no top-level await, no async/defer
// assumptions. The frame assembler injects it as a plain
// `<script src="...">` so existing widgets can read
// `window.widgetHost` at their own IIFE time (design §5.2.12).
//
// Side-effectful by design; everything testable lives in
// widget-host-shim.ts, which this file only invokes with defaults.

import { installWidgetHostShim } from "./widget-host-shim";

installWidgetHostShim();
