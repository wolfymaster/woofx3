// The two scripts the preview serves, built from source when it starts: the
// widget host shim every frame boots with, and the preview page. The shim is
// built from the module SDK's own entry, so a widget meets the shim of this
// checkout, never a stale build of it.

import { resolve } from "node:path";

/** What the preview serves that does not change while it runs. */
export interface PreviewBundles {
  /** The shim as a classic script, as frames load it. */
  shim: string;
  /** The preview page's document. */
  html: string;
  /** The preview page's module script. */
  page: string;
}

const SHIM_ENTRY = "@woofx3/module-sdk/src/widget-host-shim.entry.ts";
const PAGE_DIR = resolve(import.meta.dir, "page");

async function bundle(entry: string, format: "iife" | "esm"): Promise<string> {
  const result = await Bun.build({ entrypoints: [entry], format, target: "browser" });
  if (!result.success) {
    throw new Error(`building ${entry} failed:\n${result.logs.map((log) => String(log)).join("\n")}`);
  }
  const [output] = result.outputs;
  if (output === undefined || result.outputs.length !== 1) {
    throw new Error(`building ${entry} gave ${result.outputs.length} outputs, expected one`);
  }
  return output.text();
}

export async function buildPreviewBundles(): Promise<PreviewBundles> {
  const [shim, html, page] = await Promise.all([
    bundle(Bun.resolveSync(SHIM_ENTRY, import.meta.dir), "iife"),
    Bun.file(resolve(PAGE_DIR, "index.html")).text(),
    bundle(resolve(PAGE_DIR, "main.ts"), "esm"),
  ]);
  return { shim, html, page };
}
