/**
 * Server-rendered HTML shell for `GET /scene/{sceneId}`. Replaces
 * streamware's React/Vite SPA entirely — this is the whole client
 * surface besides the vendored data-star bundle and the small
 * scene-manager client script (see `public/scene-manager/`, built in
 * a later step).
 */
export interface SceneShellConfig {
  scene: unknown;
}

function escapeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderSceneShell(config: SceneShellConfig): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Scene</title>
<meta name="referrer" content="no-referrer">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  #widgets { position: relative; width: 100%; height: 100%; }
  .widget-frame { position: absolute; border: 0; }
  #disconnected-banner { display: none; position: fixed; inset: 0; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.75); color: #fff; font: 16px sans-serif; z-index: 9999; }
  #disconnected-banner.visible { display: flex; }
</style>
</head>
<body>
<div id="widgets"></div>
<div id="disconnected-banner"><div>Disconnected — attempting to reconnect…</div></div>
<script>window.__WOOFX3_SCENE__ = ${escapeForInlineScript(config)};</script>
<script type="module" src="/assets/vendor/datastar.js"></script>
<script type="module" src="/assets/scene-manager/index.js"></script>
</body>
</html>`;
}
