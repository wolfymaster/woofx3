// The headless composition editor: the state, commands, gestures and
// history behind the scene and alert editors, with no DOM and no framework.
// A UI renders `getState()` and forwards input; see editor.ts.

export * from "./catalog";
export * from "./editor";
export * from "./geometry";
export { COALESCE_WINDOW_MS, MAX_HISTORY_ENTRIES } from "./history";
export * from "./keymap";
export * from "./preview";
export * from "./source";
export * from "./sync-source";
