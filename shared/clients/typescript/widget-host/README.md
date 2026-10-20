# @woofx3/widget-host

The host side of a woofx3 widget. A widget's own side, the widget host shim and
the protocol it speaks, is in `@woofx3/module-sdk`.

- `@woofx3/widget-host/frame` builds the frame document a widget runs in: its
  entry HTML with the scaffold that boots the shim, its theme, and the policy
  every frame is served under (`frameDocument`).
- `@woofx3/widget-host/page` is the page around the frame: mounting it
  (`mountWidgetFrame`), the `WidgetBridge` that answers the shim, the event
  queues that feed it, and the `AssetCache` that decides which files it may read.

The scene manager serves overlays with both. Keeping them here means anything
else that hosts a widget hosts it the same way.
