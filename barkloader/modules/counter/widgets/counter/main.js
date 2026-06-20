// Counter widget
//
// Settings consumed:
//   - target        (resource_ref counter) canonical id of the counter to display
//   - labelTemplate (text)   default "{value}"  — use {value} for the count,
//                                                   {max} for the max value
//   - maxValue      (number) optional max substituted for {max} in the template
//   - fontSize      (number) default 64 (px)
//   - accentColor   (color)  default "#7ad7ff"
//
// Subscribes to `host.storage.subscribe("state:" + target)` for live updates.
// The bump animation fires on every value change so the viewer notices the update.

/// <reference types="@woofx3/module-sdk" />

(function () {
  "use strict";

  /** @type {import("@woofx3/module-sdk").WidgetHost} */
  const host = window.widgetHost;
  if (!host) {
    document.body.textContent = "no widgetHost — open this widget through the SDK preview harness or streamware";
    return;
  }

  const labelEl = document.getElementById("label");
  const settings = host.settings;

  // Apply static style settings.
  const fontSize = typeof settings.fontSize === "number" && settings.fontSize > 0
    ? settings.fontSize : 64;
  const accent = typeof settings.accentColor === "string" && settings.accentColor
    ? settings.accentColor : "#7ad7ff";
  labelEl.style.fontSize = fontSize + "px";
  document.documentElement.style.setProperty("--accent", accent);

  // Resolve the max value for {max} substitution.
  const maxValue = typeof settings.maxValue === "number" && Number.isFinite(settings.maxValue)
    ? settings.maxValue : null;

  // Label template — default to just the number.
  const labelTemplate = typeof settings.labelTemplate === "string" && settings.labelTemplate.trim()
    ? settings.labelTemplate : "{value}";

  // Render the full label string from the current counter value.
  function renderLabel(value) {
    const n = Number.isFinite(Number(value)) ? Number(value) : 0;
    let out = labelTemplate.replace(/\{value\}/g, String(n));
    if (maxValue !== null) {
      out = out.replace(/\{max\}/g, String(maxValue));
    }
    return out;
  }

  // Update the DOM and trigger the bump animation.
  function render(value) {
    labelEl.textContent = renderLabel(value);
    labelEl.classList.remove("bump");
    void labelEl.offsetWidth; // Force reflow so the animation re-triggers.
    labelEl.classList.add("bump");
  }

  // The widget must be configured against a specific counter instance.
  const target = typeof settings.target === "string" ? settings.target.trim() : "";
  if (!target) {
    labelEl.textContent = "—";
    return;
  }
  const KEY = "state:" + target;

  // Seed with the current value then subscribe for live updates.
  Promise.resolve(host.storage.get(KEY))
    .then(render)
    .catch(function () { render(0); });

  host.storage.subscribe(KEY, render);
})();
