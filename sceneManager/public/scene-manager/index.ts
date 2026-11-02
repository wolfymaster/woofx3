// The overlay page's entry: reads what the shell rendered into the page and
// starts the overlay (overlay.ts) in this browser.

import { BROWSER_HOST } from "@woofx3/widget-host/page";
import type { SceneConfig } from "../../contract/scene-config";
import { BROWSER_MARKS } from "./alert-timing";
import { createOverlay } from "./overlay";
import { PAGE_CLOCK } from "./page-clock";
import { createReconnectCoordinator } from "./reconnect-coordinator";

declare global {
  interface Window {
    __WOOFX3_SCENE__?: { scene: SceneConfig | null; document?: unknown };
  }
}

function renderConnected(connected: boolean): void {
  const banner = document.getElementById("disconnected-banner");
  banner?.classList.toggle("visible", !connected);
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
    host: BROWSER_HOST,
    clock: PAGE_CLOCK,
    marks: BROWSER_MARKS,
    coordinator: createReconnectCoordinator(),
  });
}

main();
