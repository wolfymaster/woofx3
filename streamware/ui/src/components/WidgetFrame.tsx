import { useEffect, useRef } from "react";
import {
  createWidgetHost,
  type StorageChangeStream,
  type WidgetEventSource,
  type WidgetStatusReport,
} from "../lib/widgetHost";
import type { WidgetInstance } from "../lib/sceneConfig";

interface WidgetFrameProps {
  instance: WidgetInstance;
  stream: StorageChangeStream;
  /** Per-widget event source already filtered by `acceptedEvents`.
   *  When omitted, the widget's `widgetHost.onEvent` is a no-op. */
  events?: WidgetEventSource;
  /** Upstream sender for `widgetHost.reportStatus`; passed through
   *  from the SceneOverlay's module-state socket. Optional during
   *  rollout — when absent, status reports log a warning and are
   *  dropped. */
  onWidgetEvent?: (report: WidgetStatusReport) => void;
}

/**
 * Renders a single widget instance in a sandboxed iframe. The shell
 * injects `widgetHost` onto `iframe.contentWindow` once the iframe
 * load event fires.
 *
 * Same-origin assumption: when the widget's `bundleUrl` resolves to
 * the same origin as streamware (the local-mode case), direct
 * property assignment works. When the asset URL pipeline later moves
 * widgets to a CDN on a different origin, this component will need
 * to switch to a postMessage-based bridge — flagged below at the
 * injection site so the contract stays explicit.
 *
 * The iframe sandbox keeps widget code from touching streamware's
 * own DOM / cookies / parent navigation. `allow-scripts` is required
 * for widgets to run; everything else stays denied.
 */
export default function WidgetFrame({ instance, stream, events, onWidgetEvent }: WidgetFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    function inject() {
      const win = iframe?.contentWindow as (Window & { widgetHost?: unknown }) | null;
      if (!win) return;
      try {
        win.widgetHost = createWidgetHost({
          moduleId: instance.moduleId,
          instanceId: instance.id,
          widgetCanonicalId: instance.widgetCanonicalId,
          settings: instance.settings,
          stream,
          events,
          sendStatus: onWidgetEvent,
        });
      } catch (err) {
        // Cross-origin frames throw on contentWindow access; this is
        // the trigger for migrating to postMessage when a CDN-served
        // bundle becomes the norm.
        console.error("widgetHost injection failed (cross-origin?)", err, {
          instance: instance.id,
          bundleUrl: instance.bundleUrl,
        });
      }
    }

    iframe.addEventListener("load", inject);
    return () => iframe.removeEventListener("load", inject);
  }, [
    instance.id,
    instance.moduleId,
    instance.widgetCanonicalId,
    instance.bundleUrl,
    instance.settings,
    stream,
    events,
    onWidgetEvent,
  ]);

  const { x, y, width, height } = instance.position;
  return (
    <iframe
      ref={iframeRef}
      src={instance.bundleUrl}
      title={instance.id}
      sandbox="allow-scripts allow-same-origin"
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: "none",
        background: "transparent",
      }}
      // Disable scrolling — widgets shouldn't introduce horizontal
      // overflow inside their bounding box; content that doesn't fit
      // should be clipped by the iframe rather than become scrollable.
      scrolling="no"
    />
  );
}
