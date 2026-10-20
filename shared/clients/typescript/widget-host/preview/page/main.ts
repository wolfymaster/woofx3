// Entry of the preview page: wires the controls in index.html to one
// PreviewFrame at a time, and reloads it whenever a file in the module
// changes.

import { AssetCache, EventQueueManager, type WidgetBridge } from "../../page";
import {
  CHANGE_EVENT,
  CHANGES_PATH,
  MODULE_PATH,
  type ModuleView,
  parseModuleAnswer,
  type WidgetView,
} from "../protocol";
import { PreviewFrame, type PreviewLogEntry } from "./preview-frame";
import { PreviewStorage } from "./preview-storage";
import { defaultSettings, renderSettingsForm, type SettingsForm } from "./settings-form";

function element<T extends HTMLElement>(id: string, type: { new (): T; prototype: T }): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) {
    throw new Error(`preview page: #${id} is missing from index.html`);
  }
  return found;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function main(): void {
  const stage = element("stage", HTMLDivElement);
  const problem = element("problem", HTMLDivElement);
  const moduleName = element("module-name", HTMLHeadingElement);
  const widgetSelect = element("widget", HTMLSelectElement);
  const surfaceSelect = element("surface", HTMLSelectElement);
  const width = element("width", HTMLInputElement);
  const height = element("height", HTMLInputElement);
  const settingsForm = element("settings-form", HTMLFormElement);
  const settingsContainer = element("settings", HTMLDivElement);
  const storageForm = element("storage-form", HTMLFormElement);
  const storageEntries = element("storage-entries", HTMLUListElement);
  const storageKey = element("storage-key", HTMLInputElement);
  const storageValue = element("storage-value", HTMLTextAreaElement);
  const eventForm = element("event-form", HTMLFormElement);
  const eventType = element("event-type", HTMLInputElement);
  const eventData = element("event-data", HTMLTextAreaElement);
  const logList = element("log", HTMLUListElement);

  const bridges = new Set<WidgetBridge>();
  const assets = new AssetCache({ pageOrigin: location.origin });
  const queues = new EventQueueManager();
  const storage = new PreviewStorage();
  // The settings last applied to each widget, kept across reloads.
  const appliedSettings = new Map<string, Record<string, unknown>>();
  let module: ModuleView | null = null;
  let frame: PreviewFrame | null = null;
  let form: SettingsForm | null = null;
  // What the page was opened on, until the first widget is shown.
  const initialQuery = new URLSearchParams(location.search);
  const initialSurface = initialQuery.get("surface") ?? "";

  window.addEventListener("message", (event) => {
    for (const bridge of bridges) {
      bridge.handleMessage(event);
    }
  });

  function log(entry: PreviewLogEntry): void {
    const item = document.createElement("li");
    item.className = entry.kind;
    item.textContent = `${new Date().toLocaleTimeString()}  ${entry.text}`;
    logList.prepend(item);
  }

  function showProblem(message: string | null): void {
    problem.textContent = message ?? "";
    problem.classList.toggle("shown", message !== null);
  }

  function selectedWidget(): WidgetView | null {
    return module?.widgets.find((widget) => widget.id === widgetSelect.value) ?? null;
  }

  function fitStage(): void {
    stage.style.width = `${Math.max(1, Number(width.value) || 1)}px`;
    stage.style.height = `${Math.max(1, Number(height.value) || 1)}px`;
  }

  /** Mount the selected widget afresh, on the selected surface. */
  function showWidget(): void {
    frame?.unmount();
    frame = null;
    const widget = selectedWidget();
    if (module === null || widget === null) {
      settingsContainer.replaceChildren();
      form = null;
      return;
    }
    const wantedSurface = surfaceSelect.value || initialSurface;
    surfaceSelect.replaceChildren(
      ...widget.surfaces.map((surface) => new Option(surface === "scene" ? "On a scene" : "In an alert", surface))
    );
    const surface = widget.surfaces.find((candidate) => candidate === wantedSurface) ?? widget.surfaces[0] ?? "scene";
    surfaceSelect.value = surface;
    const settings = { ...defaultSettings(widget.settingsSchema), ...appliedSettings.get(widget.id) };
    form = renderSettingsForm(document, settingsContainer, widget.settingsSchema, settings);
    const query = new URLSearchParams({ widget: widget.id, surface });
    history.replaceState(null, "", `?${query}`);
    frame = new PreviewFrame({
      slot: stage,
      moduleId: module.id,
      widgetId: widget.id,
      surface,
      settings,
      bridges,
      queues,
      assets,
      storage,
      log,
    });
  }

  async function loadModule(): Promise<void> {
    let answer: ReturnType<typeof parseModuleAnswer>;
    try {
      const response = await fetch(MODULE_PATH);
      answer = parseModuleAnswer(await response.json());
    } catch (err) {
      showProblem(`The preview server did not answer: ${err instanceof Error ? err.message : err}`);
      return;
    }
    if (answer === null) {
      showProblem("The preview server sent something this page does not understand.");
      return;
    }
    if ("error" in answer) {
      module = null;
      showProblem(answer.error.message);
      showWidget();
      return;
    }
    showProblem(answer.module.widgets.length === 0 ? "The module declares no widget with an entry." : null);
    module = answer.module;
    moduleName.textContent = module.name;
    const wanted = widgetSelect.value || initialQuery.get("widget") || "";
    widgetSelect.replaceChildren(...module.widgets.map((widget) => new Option(widget.name, widget.id)));
    if (module.widgets.some((widget) => widget.id === wanted)) {
      widgetSelect.value = wanted;
    }
    showWidget();
  }

  function renderStorage(): void {
    storageEntries.replaceChildren(
      ...storage.entries().map(([key, value]) => {
        const item = document.createElement("li");
        item.textContent = `${key} = ${JSON.stringify(value)}`;
        return item;
      })
    );
  }

  widgetSelect.addEventListener("change", showWidget);
  surfaceSelect.addEventListener("change", showWidget);
  width.addEventListener("input", fitStage);
  height.addEventListener("input", fitStage);

  settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const widget = selectedWidget();
    const read = form?.read();
    if (frame === null || widget === null || read === undefined) {
      return;
    }
    if (!read.ok) {
      log({ kind: "problem", text: `settings not applied: ${read.error}` });
      return;
    }
    appliedSettings.set(widget.id, read.settings);
    if (frame.applySettings(read.settings) === "none") {
      log({ kind: "settings", text: "no setting changed" });
    }
  });

  storageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = parseJson(storageValue.value);
    if (!value.ok) {
      log({ kind: "problem", text: `storage not set: ${value.error}` });
      return;
    }
    storage.set(storageKey.value, value.value);
    renderStorage();
  });

  eventForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = parseJson(eventData.value);
    if (!data.ok) {
      log({ kind: "problem", text: `event not fired: ${data.error}` });
      return;
    }
    frame?.fire(eventType.value, data.value);
  });

  element("clear-log", HTMLButtonElement).addEventListener("click", () => logList.replaceChildren());

  fitStage();
  void loadModule();

  const changes = new EventSource(CHANGES_PATH);
  changes.addEventListener(CHANGE_EVENT, () => {
    log({ kind: "frame", text: "the module's files changed" });
    void loadModule();
  });
  changes.addEventListener("error", () => {
    if (changes.readyState === EventSource.CONNECTING) {
      log({ kind: "problem", text: "lost the preview server; reconnecting" });
    }
  });
}

main();
