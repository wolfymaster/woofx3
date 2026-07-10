import type { CommandSnapshot, CommandType, Scene, WorkflowDefinition } from "@woofx3/api";
import type * as command from "@woofx3/db/command.pb";
import type * as scene from "@woofx3/db/scene.pb";
import * as protoscript from "protoscript";

/**
 * Helper to create a protoscript.Timestamp from a Date
 */
export function timestampFromDate(date: Date): protoscript.Timestamp {
  const seconds = Math.floor(date.getTime() / 1000);
  const nanos = (date.getTime() % 1000) * 1000000;
  return {
    seconds: BigInt(seconds),
    nanos,
  };
}

/**
 * Convert a protoscript.Timestamp (or anything shaped like one) to an ISO
 * 8601 string. Falls back to `new Date().toISOString()` when the input is
 * missing or has no `seconds` — the engine treats every workflow row as
 * having valid timestamps, so the fallback is only defensive.
 */
export function timestampToIso(ts: { seconds?: bigint; nanos?: number } | undefined): string {
  if (!ts || ts.seconds === undefined) {
    return new Date().toISOString();
  }
  const ms = Number(ts.seconds) * 1000 + Math.floor((ts.nanos ?? 0) / 1_000_000);
  return new Date(ms).toISOString();
}

/**
 * Convert a db-proxy `Scene` row into the lightweight wire shape the
 * shared API exposes (`{ id, name, accountId, widgets, createdAt }`).
 * `widgets_json` is parsed best-effort — the engine never inspects it,
 * but the wire `SceneWidget[]` interface is structurally compatible
 * with the editor's instance shape (a superset is fine).
 */
export function dbSceneToWire(s: scene.Scene): Scene {
  const widgets = parseSceneWidgets(s.widgetsJson ?? "");
  return {
    id: s.id ?? "",
    name: s.name ?? "",
    accountId: s.applicationId ?? "",
    widgets,
    createdAt: timestampToIso(s.createdAt),
  };
}

/**
 * Convert a db-proxy `Scene` row into the rich `SceneSnapshot` shape
 * the webhook event carries. The engine doesn't peek inside the JSON
 * columns — they round-trip verbatim so the Convex side can parse
 * them with the full widget-instance shape it knows about.
 */
export function dbSceneToSnapshot(s: scene.Scene): {
  id: string;
  applicationId: string;
  name: string;
  description: string;
  widgetsJson: string;
  layoutJson: string;
  createdByType: string;
  createdByRef: string;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: s.id ?? "",
    applicationId: s.applicationId ?? "",
    name: s.name ?? "",
    description: s.description ?? "",
    widgetsJson: s.widgetsJson ?? "[]",
    layoutJson: s.layoutJson ?? "{}",
    createdByType: s.createdByType ?? "USER",
    createdByRef: s.createdByRef ?? "",
    createdAt: timestampToIso(s.createdAt),
    updatedAt: timestampToIso(s.updatedAt),
  };
}

/**
 * Parse `widgetsJson` for the wire `Scene.widgets` array. Drops
 * entries that lack the minimum shape (id + position + size) — a
 * defensive call since the engine has never validated this column.
 */
function parseSceneWidgets(raw: string): Scene["widgets"] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: Scene["widgets"] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const obj = entry as Record<string, unknown>;
      const id = typeof obj.id === "string" ? obj.id : null;
      if (!id) {
        continue;
      }
      const positionRaw = obj.position as Record<string, unknown> | undefined;
      const sizeRaw = obj.size as Record<string, unknown> | undefined;
      const x = positionRaw && typeof positionRaw.x === "number" ? positionRaw.x : 0;
      const y = positionRaw && typeof positionRaw.y === "number" ? positionRaw.y : 0;
      const w = sizeRaw && typeof sizeRaw.w === "number" ? sizeRaw.w : 0;
      const h = sizeRaw && typeof sizeRaw.h === "number" ? sizeRaw.h : 0;
      const type = typeof obj.type === "string" ? obj.type : "";
      out.push({ id, type, position: { x, y }, size: { w, h } });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Rebuild a `WorkflowDefinition` from the engine-shape JSON columns
 * persisted on a Workflow proto. Returns `null` when the workflow has
 * no trigger (an unrecoverable shape — the engine refuses to register
 * a workflow without a trigger anyway).
 *
 * The pre-Phase-C path stored the full WorkflowDefinition as a single
 * `_definition` variable; that's gone now and the canonical source is
 * `stepsJson` + `triggerJson` straight off the workflow row.
 */
export function rebuildWorkflowDefinition(wf: {
  id?: string;
  name?: string;
  description?: string;
  stepsJson?: string;
  triggerJson?: string;
}): WorkflowDefinition | null {
  if (!wf.triggerJson) {
    return null;
  }
  let trigger: WorkflowDefinition["trigger"];
  let tasks: WorkflowDefinition["tasks"];
  try {
    trigger = JSON.parse(wf.triggerJson) as WorkflowDefinition["trigger"];
    tasks = wf.stepsJson ? (JSON.parse(wf.stepsJson) as WorkflowDefinition["tasks"]) : [];
  } catch {
    return null;
  }
  return {
    id: wf.id ?? "",
    name: wf.name ?? "",
    description: wf.description,
    trigger,
    tasks,
  };
}

/**
 * Narrow the engine's protobuf Command type to the shared API
 * CommandSnapshot. The proto's `type` field is a free-form string but the
 * UI only ever creates one of three known values; we cast through
 * `CommandType` so consumers don't have to re-validate.
 */
export function commandToSnapshot(c: command.Command): CommandSnapshot {
  return {
    id: c.id,
    applicationId: c.applicationId,
    command: c.command,
    type: c.type as CommandType,
    typeValue: c.typeValue,
    cooldown: c.cooldown,
    priority: c.priority,
    enabled: c.enabled,
  };
}

/**
 * Extract the catalog-facing fields the UI surfaces for an installed module
 * from the manifest JSON the engine stores on `modules.manifest`.
 *
 * Author and category come straight from the manifest authored by the
 * module developer. Both fall back to "Unknown" when missing, blank, or
 * when the stored manifest is malformed — the UI must always have a
 * concrete string to render.
 */
export function readModuleCatalogFields(rawManifest: string | undefined): {
  author: string;
  category: string;
} {
  const fallback = { author: "Unknown", category: "Unknown" };
  if (!rawManifest) {
    return fallback;
  }
  let parsed: { author?: unknown; category?: unknown } = {};
  try {
    const v = JSON.parse(rawManifest);
    if (v && typeof v === "object") {
      parsed = v as { author?: unknown; category?: unknown };
    }
  } catch {
    return fallback;
  }
  const pick = (val: unknown, key: "author" | "category"): string => {
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed !== "") {
        return trimmed;
      }
    }
    return fallback[key];
  };
  return {
    author: pick(parsed.author, "author"),
    category: pick(parsed.category, "category"),
  };
}
