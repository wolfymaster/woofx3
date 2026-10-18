// The overlay page's entry: reads what the shell rendered into the page and
// starts the overlay (overlay.ts) in this browser.

import type { SceneConfig } from "../../contract/scene-config";
import { createOverlay } from "./overlay";

declare global {
  interface Window {
    __WOOFX3_SCENE__?: { scene: SceneConfig | null; document?: unknown };
  }
}

function renderConnected(connected: boolean): void {
  const banner = document.getElementById("disconnected-banner");
  banner?.classList.toggle("visible", !connected);
  // Data-star's reactive store gets the same verdict, for any `data-show` or
  // `data-class` binding on it. The class toggle above is what shows the
  // banner either way.
  try {
    document.dispatchEvent(new CustomEvent("datastar-signal-patch", { detail: { connected } }));
  } catch {
    // Data-star not loaded, or the signal not declared.
  }
}

function main(): void {
  const scene = window.__WOOFX3_SCENE__?.scene;
  const root = document.getElementById("widgets");
  if (!scene || !root) {
    return;
  }
  createOverlay({
    scene,
    sceneDocument: window.__WOOFX3_SCENE__?.document,
    document,
    root,
    location: {
      search: location.search,
      href: location.href,
      origin: location.origin,
      reload: () => location.reload(),
    },
    window,
    framed: window.parent !== window,
    fetch: (url, init) => fetch(url, init),
    renderConnected,
  });
}

main();
