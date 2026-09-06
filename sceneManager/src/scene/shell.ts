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

  /* Connection indicator. Deliberately a small corner badge rather than
     a full-screen scrim: this sits on a live stream overlay, so a lost
     connection must be obvious to the operator without blacking out the
     scene for viewers.

     The reveal works by pinning the pill's right edge and letting it
     grow leftward, carrying the icon with it. That anchoring is a
     full-width flex track with justify-content:flex-end, NOT a
     shrink-to-fit right-anchored box: shrink-to-fit resolves against
     the label's intrinsic width, which fights the animating max-width
     and lets the pill drift off the right edge mid-transition. The
     track itself is pointer-events:none so a purely informational
     badge can never intercept clicks meant for the scene.

     No JS drives any of this -- the cycle is a pure CSS animation, and
     it only runs while the .visible class is set, since display:none
     suspends animations and restarts them from the beginning when the
     class comes back. */
  #disconnected-banner { display: none; position: fixed; top: 12px; left: 0; right: 12px;
    justify-content: flex-end; align-items: flex-start; pointer-events: none; z-index: 9999; }
  #disconnected-banner.visible { display: flex; }

  #disconnected-pill { flex: 0 0 auto; display: flex; align-items: center; height: 32px; border-radius: 6px;
    background: #d92020; box-shadow: 0 2px 8px rgba(0,0,0,0.45); overflow: hidden; }

  /* Fixed 32px basis so the collapsed pill is a true square: the flex
     item must not shrink as the label expands beside it. */
  #disconnected-icon { flex: 0 0 32px; width: 32px; height: 32px; display: flex; align-items: center;
    justify-content: center; animation: dc-spin 16s ease-in-out infinite; }
  #disconnected-icon svg { display: block; width: 18px; height: 18px; }

  /* max-width clips the label, but padding is never clipped by it --
     so the horizontal padding has to animate too, or the collapsed
     pill would sit 12px wider than the icon and stop being square.

     The cap sits ~30% above the label's measured intrinsic width
     (200px here). It has to clear it, since font metrics differ across
     platforms and a cap fitted to one machine truncates the message on
     another -- but not by so much that the reveal finishes early and
     then visibly stalls for the rest of the transition. Re-check this
     if the label text changes length. */
  #disconnected-text { max-width: 0; padding-right: 0; opacity: 0; overflow: hidden; white-space: nowrap;
    color: #fff; font: 600 13px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
    animation: dc-reveal 16s ease-in-out infinite; }

  /* 16s cycle: 5s expanded, 0.5s collapse, 10s collapsed, 0.5s expand.
     Deliberately starts expanded -- the animation restarts from 0%
     every time the badge becomes visible, so a fresh disconnect shows
     the message straight away instead of hiding it behind a 10s wait.
     Percentages are exact: 5/16 = 31.25%, 5.5/16 = 34.375%,
     15.5/16 = 96.875%. */
  @keyframes dc-reveal {
    0%, 31.25%       { max-width: 260px; padding-right: 12px; opacity: 1; }
    34.375%, 96.875% { max-width: 0;     padding-right: 0;    opacity: 0; }
    100%             { max-width: 260px; padding-right: 12px; opacity: 1; }
  }

  /* One full turn per transition, in the same direction both times so
     the icon never visibly unwinds. Rotation is held flat across both
     long holds -- the spin marks the change of state, it is not an
     idle animation. */
  @keyframes dc-spin {
    0%, 31.25%       { transform: rotate(0deg); }
    34.375%, 96.875% { transform: rotate(360deg); }
    100%             { transform: rotate(720deg); }
  }

  /* Motion is the whole mechanism here, so the fallback isn't "no
     animation" -- it's the expanded state, which still carries the
     message. */
  @media (prefers-reduced-motion: reduce) {
    #disconnected-icon, #disconnected-text { animation: none; }
    #disconnected-text { max-width: 260px; padding-right: 12px; opacity: 1; }
  }
</style>
</head>
<body>
<div id="widgets"></div>
<div id="disconnected-banner">
  <div id="disconnected-pill">
    <span id="disconnected-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-.12-7.07 5 5 0 0 0-6.95 0l-1.72 1.71"/>
        <path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 .12 7.07 5 5 0 0 0 6.95 0l1.71-1.71"/>
        <line x1="8" y1="2" x2="8" y2="5"/>
        <line x1="2" y1="8" x2="5" y2="8"/>
        <line x1="16" y1="19" x2="16" y2="22"/>
        <line x1="19" y1="16" x2="22" y2="16"/>
      </svg>
    </span>
    <span id="disconnected-text">woofx3 overlay disconnected</span>
  </div>
</div>
<script>window.__WOOFX3_SCENE__ = ${escapeForInlineScript(config)};</script>
<script type="module" src="/assets/vendor/datastar.js"></script>
<script type="module" src="/assets/scene-manager/index.js"></script>
</body>
</html>`;
}
