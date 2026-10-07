// Setting bindings: how a widget shows its settings without script.
//
// The widget host shim mirrors a placement's settings into the frame's
// document, and mirrors them again on every change, so a widget written
// against these never needs code to stay current:
//
//   --setting-{id}            on :root, every setting with a plain value:
//                             text as written, numbers, booleans as 1 / 0,
//                             a media setting's { url } as url("…").
//                               color: var(--setting-color, #fff);
//                               font-size: calc(var(--setting-fontSize, 48) * 1px);
//   data-setting-{id}         on <html>, booleans as "true" / "false" and
//                             short text, for selectors:
//                               :root[data-setting-showpanel="false"] .panel { display: none; }
//                             Attribute names are lowercased by HTML.
//   data-setting="{id}"       an element's text content is the setting
//   data-setting-src="{id}"   an element's src (likewise href, poster) is the
//                             setting's URL; only http(s), data:image and
//                             relative URLs are applied
//
// A setting the placement has no value for leaves what the widget wrote in
// place, so an element's own text and a var()'s fallback are its defaults.

/** The slice of an element bindings touch. */
export interface BindingElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  textContent: string | null;
}

/** The slice of a document bindings touch (injectable for tests). */
export interface BindingDocument {
  documentElement: BindingElement & {
    style: { setProperty(name: string, value: string): void; removeProperty(name: string): string };
  };
  querySelectorAll(selector: string): ArrayLike<BindingElement>;
}

const URL_ATTRIBUTES = ["src", "href", "poster"] as const;
const ELEMENT_SELECTOR = ["[data-setting]", ...URL_ATTRIBUTES.map((a) => `[data-setting-${a}]`)].join(", ");
const SETTING_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const MAX_ATTRIBUTE_TEXT = 64;

/**
 * Mirror `settings` into `doc`. `previous` is the set mirrored last time, so
 * a setting that has gone is cleared rather than left at its old value.
 */
export function applySettingBindings(
  doc: BindingDocument,
  settings: Readonly<Record<string, unknown>>,
  previous: Readonly<Record<string, unknown>> = {}
): void {
  const root = doc.documentElement;
  for (const id of Object.keys(previous)) {
    if (!Object.hasOwn(settings, id) && SETTING_ID.test(id)) {
      root.style.removeProperty(`--setting-${id}`);
      root.removeAttribute(`data-setting-${id}`);
    }
  }
  for (const [id, value] of Object.entries(settings)) {
    if (!SETTING_ID.test(id)) {
      continue;
    }
    const css = cssValue(value);
    if (css === null) {
      root.style.removeProperty(`--setting-${id}`);
    } else {
      root.style.setProperty(`--setting-${id}`, css);
    }
    const attribute = attributeValue(value);
    if (attribute === null) {
      root.removeAttribute(`data-setting-${id}`);
    } else {
      root.setAttribute(`data-setting-${id}`, attribute);
    }
  }

  const elements = doc.querySelectorAll(ELEMENT_SELECTOR);
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!;
    // <html> carries the data-setting-{id} mirror above, which would read
    // as element bindings for settings named src, href or poster.
    if (element === root) {
      continue;
    }
    const textId = element.getAttribute("data-setting");
    if (textId !== null && Object.hasOwn(settings, textId)) {
      element.textContent = textOf(settings[textId]);
    }
    for (const name of URL_ATTRIBUTES) {
      const id = element.getAttribute(`data-setting-${name}`);
      if (id === null || !Object.hasOwn(settings, id)) {
        continue;
      }
      const url = urlOf(settings[id]);
      if (url !== null) {
        element.setAttribute(name, url);
      }
    }
  }
}

function cssValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  const url = mediaUrl(value);
  return url === null ? null : `url("${url.replace(/["\\\n\r]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}")`;
}

function attributeValue(value: unknown): string | null {
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string" && value.length <= MAX_ATTRIBUTE_TEXT && !/[\r\n]/.test(value)) {
    return value;
  }
  return null;
}

function textOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/** A media setting is a URL, or the asset picker's `{ url, ... }`. */
function mediaUrl(value: unknown): string | null {
  if (typeof value === "object" && value !== null && typeof (value as { url?: unknown }).url === "string") {
    return (value as { url: string }).url;
  }
  return null;
}

function urlOf(value: unknown): string | null {
  const url = typeof value === "string" ? value : mediaUrl(value);
  if (url === null) {
    return null;
  }
  const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!scheme) {
    return url;
  }
  const name = scheme[1]!.toLowerCase();
  return name === "http" || name === "https" || (name === "data" && /^\s*data:image\//i.test(url)) ? url : null;
}
