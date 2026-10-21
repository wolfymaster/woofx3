// The placement settings form, built from a widget's `settingsSchema`. Each
// field gets the plain control its value needs; a field whose value is more
// than one control can hold (a list, a layout, a picked asset) is edited as
// JSON, in the shape the dashboard's picker would store.

import type { ConfigField } from "@woofx3/api/ui-schema";

export type ControlKind = "number" | "range" | "text" | "select" | "toggle" | "color" | "json";

/**
 * The control a field is edited with, or null for one that holds no
 * placement value: a button fires a request, and the theme field picks an
 * installed theme, which the preview has none of.
 */
export function controlKind(field: ConfigField): ControlKind | null {
  switch (field.type) {
    case "number":
    case "range":
    case "text":
    case "toggle":
    case "color":
      return field.type;
    case "font":
      return "text";
    case "select":
      return field.options !== undefined && field.options.length > 0 ? "select" : "text";
    case "media":
    case "asset":
    case "resource_ref":
    case "layout":
    case "list":
      return "json";
    case "button":
    case "theme":
      return null;
    default:
      throw new Error(`settings form: no control for field type ${JSON.stringify(field.type satisfies never)}`);
  }
}

/** A placement's settings before anything is edited: each field's `defaultValue`, where it declares one. */
export function defaultSettings(fields: readonly ConfigField[]): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const field of fields) {
    if (controlKind(field) !== null && field.defaultValue !== undefined) {
      settings[field.id] = structuredClone(field.defaultValue);
    }
  }
  return settings;
}

/** What a control holds: a value (`undefined` when the setting is left unset), or why its text is no value. */
export type ControlValue = { ok: true; value: unknown } | { ok: false; error: string };

/** The value of a control of `kind` holding `raw`: a checkbox's state, or an input's text. */
export function readControl(kind: ControlKind, raw: string | boolean): ControlValue {
  if (kind === "toggle") {
    return { ok: true, value: raw === true };
  }
  const text = String(raw);
  if (text.trim() === "" && kind !== "text") {
    return { ok: true, value: undefined };
  }
  switch (kind) {
    case "number":
    case "range": {
      const value = Number(text);
      return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: `${text} is not a number` };
    }
    case "json":
      try {
        return { ok: true, value: JSON.parse(text) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    default:
      return { ok: true, value: text };
  }
}

/** The text a control of `kind` shows for `value`. */
export function controlText(kind: ControlKind, value: unknown): string {
  if (value === undefined) {
    return "";
  }
  if (kind === "json") {
    return JSON.stringify(value, null, 2);
  }
  return typeof value === "string" ? value : String(value);
}

export interface SettingsForm {
  /** The settings the form holds, or the first field whose text is no value. */
  read(): { ok: true; settings: Record<string, unknown> } | { ok: false; error: string };
}

/** Fill `container` with a control per field, showing `values`. */
export function renderSettingsForm(
  doc: Document,
  container: HTMLElement,
  fields: readonly ConfigField[],
  values: Readonly<Record<string, unknown>>
): SettingsForm {
  container.replaceChildren();
  const readers: Array<() => { id: string; label: string; read: ControlValue }> = [];
  for (const field of fields) {
    const kind = controlKind(field);
    if (kind === null) {
      continue;
    }
    const label = doc.createElement("label");
    label.className = kind === "toggle" ? "field toggle" : "field";
    const caption = doc.createElement("span");
    caption.textContent = field.label;
    const control = createControl(doc, field, kind, values[field.id]);
    label.append(caption, control);
    if (field.description) {
      const description = doc.createElement("small");
      description.textContent = field.description;
      label.append(description);
    }
    container.append(label);
    readers.push(() => ({
      id: field.id,
      label: field.label,
      read: readControl(
        kind,
        control instanceof HTMLInputElement && kind === "toggle" ? control.checked : control.value
      ),
    }));
  }
  if (readers.length === 0) {
    const none = doc.createElement("p");
    none.className = "muted";
    none.textContent = "This widget declares no settings.";
    container.append(none);
  }
  return {
    read() {
      const settings: Record<string, unknown> = {};
      for (const reader of readers) {
        const { id, label, read } = reader();
        if (!read.ok) {
          return { ok: false, error: `${label}: ${read.error}` };
        }
        if (read.value !== undefined) {
          settings[id] = read.value;
        }
      }
      return { ok: true, settings };
    },
  };
}

function createControl(
  doc: Document,
  field: ConfigField,
  kind: ControlKind,
  value: unknown
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (kind === "json") {
    const area = doc.createElement("textarea");
    area.value = controlText(kind, value);
    area.placeholder = field.placeholder ?? "JSON";
    return area;
  }
  if (kind === "select") {
    const select = doc.createElement("select");
    for (const option of [{ value: "", label: "(unset)" }, ...(field.options ?? [])]) {
      const element = doc.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = controlText(kind, value);
    return select;
  }
  const input = doc.createElement("input");
  if (kind === "toggle") {
    input.type = "checkbox";
    input.checked = value === true;
    return input;
  }
  // A color is typed rather than picked: a color input holds only #rrggbb,
  // and a setting may be any CSS color.
  input.type = kind === "number" || kind === "range" ? "number" : "text";
  if (field.min !== undefined) {
    input.min = String(field.min);
  }
  if (field.max !== undefined) {
    input.max = String(field.max);
  }
  input.placeholder = field.placeholder ?? (kind === "color" ? "#rrggbb" : "");
  input.value = controlText(kind, value);
  return input;
}
