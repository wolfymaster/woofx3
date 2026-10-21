// Whether a change of settings can be handed to a running widget or needs a
// fresh frame. Every page that hosts a widget decides it the same way, so a
// widget is reloaded for the same changes in the author preview as on stream.

import { sameValue } from "@woofx3/scene/model";

/** The settings a widget's script has read; `all` when it read every one. */
export interface SettingsReads {
  all: boolean;
  keys: ReadonlySet<string>;
}

/**
 * What a change of settings takes for a widget whose frame stays. `patch`
 * hands them over and the shim updates the widget's bindings in place;
 * `reload` swaps in a fresh frame, needed when the widget's script read a
 * setting that changed, or when what it read is not known yet.
 */
export function settingsUpdate(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  reads: SettingsReads | null
): "none" | "patch" | "reload" {
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
  const changed = [...keys].filter((key) => !sameValue(current[key], next[key]));
  if (changed.length === 0) {
    return "none";
  }
  if (reads === null || reads.all || changed.some((key) => reads.keys.has(key))) {
    return "reload";
  }
  return "patch";
}
