# @woofx3/widget-host

The host side of a woofx3 widget. A widget's own side, the widget host shim and
the protocol it speaks, is in `@woofx3/module-sdk`.

- `@woofx3/widget-host/frame` builds the frame document a widget runs in: its
  entry HTML with the scaffold that boots the shim, its theme, and the policy
  every frame is served under (`frameDocument`).
- `@woofx3/widget-host/page` is the page around the frame: mounting it
  (`mountWidgetFrame`), the `WidgetBridge` that answers the shim, the event
  queues that feed it, the `AssetCache` that decides which files it may read,
  and `settingsUpdate`, which decides whether a settings change can be patched
  into a running widget.
- `preview/` is `woofx3-widget-preview`, a dev server that hosts a module's
  widgets from its folder with both, so a widget author sees what the overlay
  will do without running the engine.

The scene manager serves overlays with `frame` and `page`. Keeping them here
means anything else that hosts a widget hosts it the same way.

## Previewing a module's widgets

```bash
bun shared/clients/typescript/widget-host/preview/cli.ts path/to/my-module
# previewing My Module (2 widgets) at http://127.0.0.1:4400/
```

The folder is the module as it will be zipped, with its `manifest.json`. The
preview reads the manifest on every request and reloads the widget when any
file in the folder changes. Options: `--port` (default 4400, `0` for any free
port) and `--host` (default `127.0.0.1`).

What runs is what an overlay runs:

- Each widget's frame document is built by `frameDocument` from its entry, as
  the scene manager builds it, under the same policy (`connect-src 'none'`,
  sandboxed with `allow-scripts` only) and booting the widget host shim built
  from this checkout's module SDK source.
- The widget's files are served under the engine path its resource base names
  (`/assets/modules/{moduleId}/preview/widgets/{widgetId}/`), so
  `widgetHost.getResourceUrl` and `widgetHost.assets.load` resolve as they do
  on stream, and a file read the engine would refuse is refused here.
- The page answers the frame with the real `WidgetBridge`, event queue and
  `AssetCache`. Settings are applied with `settingsUpdate`: patched in when the
  widget's script never read what changed, a fresh frame when it did.
- A widget with a theme contract renders with the contract defaults and runs
  under the theme policy. Font settings load their Google Fonts family through
  the preview's own origin, as overlays load it through the engine's.

The page builds the settings form from the widget's `settingsSchema`, lets the
author choose the surface (a scene, or inside an alert, where a widget gets no
storage), set module storage, fire events, and logs every status report, event
completion and file read. The widget's own `console` output is in the browser's
developer tools, in the frame's context.

What the preview does not have: an asset library (library paths are not found),
installed themes, linked resources, and the overlay's own transitions and
effects. It reads only the parts of the manifest it needs, so a widget that
runs here can still fail to install.
