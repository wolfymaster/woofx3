/**
 * The HTML of `GET /preview/composition`. It carries nothing about any
 * composition: the page that frames it posts one (see
 * public/scene-manager/composition-preview-page.ts). Transparent, so the
 * editor's own backdrop shows through the canvas.
 */
export function renderCompositionPreviewShell(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Composition preview</title>
<meta name="referrer" content="no-referrer">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  #viewport { position: relative; width: 100%; height: 100%; overflow: hidden; }
  #stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .widget-frame { position: absolute; left: 0; top: 0; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<div id="viewport"><div id="stage"></div></div>
<script type="module" src="/assets/scene-manager/composition-preview-page.js"></script>
</body>
</html>`;
}
