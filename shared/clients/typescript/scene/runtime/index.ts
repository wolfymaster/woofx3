// The overlay renderer: plans what a composition shows at a moment
// (`planFrame`), diffs two plans into page writes (`diffPlans`), applies them
// to the DOM (`createDomRenderer`) and keeps them in step with the timeline
// as a composition plays (`createScheduler`). `preview-protocol` is the
// message protocol of sceneManager's composition preview page, which the
// editor drives.

export * from "./diff";
export * from "./dom";
export * from "./plan";
export * from "./preview-protocol";
export * from "./scheduler";
