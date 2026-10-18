// Mounting one widget frame: the one way every page (the overlay, its alert
// areas, the editor's composition preview) puts a widget on screen, so the
// sandbox, the nonce, the bridge and the teardown are the same everywhere and
// a page supplies only where the frame comes from and what its bridge does.

import { createFrameLoadHandler, WidgetBridge, type WidgetBridgeCallbacks } from "./widget-bridge";

/** A per-frame nonce: 128 random bits, base64url. Every protocol message in both directions carries it. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** What a page's bridge callbacks are built with. */
export interface WidgetFrameContext {
  /** This frame's nonce, the same one its document is booted with. */
  nonce: string;
  /** The frame's bridge; callbacks call it only after the frame is mounted. */
  bridge(): WidgetBridge;
}

export interface WidgetFrameOptions {
  slot: HTMLElement;
  /** The id the bridge reports under: the placement's, or an alert widget's `{eventId}.{widgetId}`. */
  instanceId: string;
  /** The frame document's URL, given this frame's nonce. */
  src(nonce: string): string;
  callbacks(context: WidgetFrameContext): WidgetBridgeCallbacks;
  /** The page's bridges, which its message listener hands each message to. */
  bridges: Set<WidgetBridge>;
  /** Mounted transparent until `reveal`: a frame loading to replace another. */
  hidden?: boolean;
  /** Teardown the page needs beyond the frame's own (storage watches, say). */
  onUnmount?(): void;
}

export interface WidgetFrame {
  element: HTMLIFrameElement;
  bridge: WidgetBridge;
  nonce: string;
  reveal(): void;
  unmount(): void;
}

export function mountWidgetFrame(options: WidgetFrameOptions): WidgetFrame {
  const nonce = generateNonce();
  const iframe = document.createElement("iframe");
  iframe.className = "widget-frame";
  if (options.hidden) {
    iframe.style.opacity = "0";
  }
  // No allow-same-origin: the frame runs with an opaque origin, and trust is
  // established entirely by postMessage source identity and the per-frame
  // nonce, never by same-origin access. The frame's own CSP says the same.
  iframe.setAttribute("sandbox", "allow-scripts");

  let mounted: WidgetBridge | null = null;
  const bridge = new WidgetBridge(
    options.instanceId,
    nonce,
    options.callbacks({
      nonce,
      bridge: () => {
        if (mounted === null) {
          throw new Error("widget frame: a bridge callback ran before the frame was mounted");
        }
        return mounted;
      },
    })
  );
  mounted = bridge;
  iframe.addEventListener("load", createFrameLoadHandler(bridge));
  iframe.src = options.src(nonce);

  options.bridges.add(bridge);
  options.slot.appendChild(iframe);
  bridge.attach(iframe);

  let unmounted = false;
  return {
    element: iframe,
    bridge,
    nonce,
    reveal: () => {
      iframe.style.opacity = "";
    },
    unmount: () => {
      if (unmounted) {
        return;
      }
      unmounted = true;
      bridge.dispose();
      bridge.detach();
      options.bridges.delete(bridge);
      options.onUnmount?.();
      iframe.remove();
    },
  };
}
