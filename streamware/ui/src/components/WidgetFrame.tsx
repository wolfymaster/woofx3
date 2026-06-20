// P1 parent-side iframe host. Creates a WidgetBridge, registers it
// with the SceneManager on mount, and detaches on unmount.
//
// Token-mode (frameUrl present): appends the per-frame nonce as a
// query parameter so the frame assembler echoes it into the boot
// payload.
//
// Legacy mode (bundleUrl only): uses bundleUrl directly; nonce is
// still generated and held on the bridge for the handshake.
//
// iframe sandbox: "allow-scripts" ONLY — no allow-same-origin, no
// allow-forms. referrerPolicy="no-referrer" because frame URLs
// contain the token (design §5.2).

import { useEffect, useRef } from "react";
import type { WidgetInstance } from "../lib/sceneConfig";
import type { SceneManager } from "../lib/sceneManager";
import { WidgetBridge } from "../lib/widgetBridge";
import type { WidgetStatusReport } from "@woofx3/module-sdk";

interface WidgetFrameProps {
  instance: WidgetInstance;
  manager: SceneManager;
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // base64url-encode without padding.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export default function WidgetFrame({ instance, manager }: WidgetFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Nonce is stable for the lifetime of this mount. A new mount (e.g.
  // after remount from React key change) generates a fresh nonce.
  const nonceRef = useRef<string>(generateNonce());

  useEffect(() => {
    const nonce = nonceRef.current;
    const bridge = new WidgetBridge(instance.id, nonce, {
      onStorageGet(moduleId: string, key: string): unknown {
        // Storage reads are satisfied from the scene manager's storage
        // subscription cache when available; returning null is valid.
        void moduleId;
        void key;
        return null;
      },
      onStorageSubscribe(moduleId: string, key: string, bridgeId: string): void {
        manager.addStorageSubscription(bridgeId, moduleId, key);
      },
      onStorageUnsubscribe(moduleId: string, key: string, bridgeId: string): void {
        manager.removeStorageSubscription(bridgeId, moduleId, key);
      },
      onStatusReport(report: WidgetStatusReport): void {
        manager["onSendStatus"]?.(report);
      },
      onDispose(): void {},
    });

    const iframe = iframeRef.current;
    if (iframe) {
      bridge.attach(iframe);
    }

    const acceptedEvents = instance.acceptedEvents ?? [];
    manager.registerBridge(instance.id, bridge, acceptedEvents);

    // The first `load` fires after the initial document finishes loading —
    // by that point the hello/init handshake has already completed. Only
    // subsequent fires indicate an in-frame navigation that requires a
    // fresh handshake.
    let loadCount = 0;
    function onLoad(): void {
      if (++loadCount > 1) {
        bridge.onFrameLoad();
      }
    }

    iframe?.addEventListener("load", onLoad);

    return () => {
      iframe?.removeEventListener("load", onLoad);
      bridge.detach();
      manager.unregisterBridge(instance.id);
    };
    // Intentionally omits instance.settings and other stable fields —
    // the bridge is created once per mount; config changes re-key the
    // component from above causing a fresh mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id, manager]);

  const nonce = nonceRef.current;
  const { x, y, width, height } = instance.position;

  const src = instance.frameUrl
    ? `${instance.frameUrl}?nonce=${encodeURIComponent(nonce)}`
    : (instance.bundleUrl ?? "");

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={instance.id}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      scrolling="no"
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: "none",
        background: "transparent",
      }}
    />
  );
}
