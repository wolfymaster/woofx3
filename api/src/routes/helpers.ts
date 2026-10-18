import type {
  ActionStep,
  AlertComposition,
  CommandSnapshot,
  CompositionKind,
  Scene,
  WorkflowDefinition,
} from "@woofx3/api";
import type { SceneSnapshot } from "@woofx3/api/webhooks";
import type { TaskDefinition } from "@woofx3/api/workflow-definition";
import type * as command from "@woofx3/db/command.pb";
import type * as scene from "@woofx3/db/scene.pb";
import type * as protoscript from "protoscript";
import type { DbClient } from "../db-client";

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
 * The RPCs that read and write `scene.publicUrl` (`overlayPublicUrl` on
 * `getEngineInfo`, `setOverlayPublicUrl`) keep their names: they are
 * Convex's public contract.
 */
export async function resolveSceneManagerUrl(db: DbClient, configured: string): Promise<string> {
  const dbValue = await db.getSetting("scene.publicUrl");
  return (dbValue || configured).replace(/\/+$/, "");
}

/**
 * Convert a db-proxy `Scene` row into the lightweight wire shape the
 * shared API exposes (`{ id, name, widgets, createdAt }`).
 * `widgets_json` is parsed best-effort — the engine never inspects it,
 * but the wire `SceneWidget[]` interface is structurally compatible
 * with the editor's instance shape (a superset is fine).
 */
export function dbSceneToWire(s: scene.Scene): Scene {
  const widgets = parseSceneWidgets(s.widgetsJson ?? "");
  return {
    id: s.id ?? "",
    name: s.name ?? "",
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
export function dbSceneToSnapshot(s: scene.Scene): SceneSnapshot {
  return {
    id: s.id ?? "",
    kind: compositionKindOf(s.kind),
    name: s.name ?? "",
    description: s.description ?? "",
    widgetsJson: s.widgetsJson ?? "[]",
    layoutJson: s.layoutJson ?? "{}",
    behaviorsJson: s.behaviorsJson || "{}",
    inputsJson: s.inputsJson || "[]",
    createdByType: s.createdByType ?? "USER",
    createdByRef: s.createdByRef ?? "",
    createdAt: timestampToIso(s.createdAt),
    updatedAt: timestampToIso(s.updatedAt),
  };
}

/**
 * The kind a db-proxy row or outbox event names. Empty is a scene: a row
 * read from a db-proxy that predates kinds is one. Any other value means
 * the two disagree on what kinds exist, which no reader can paper over.
 */
export function compositionKindOf(kind: string | undefined): CompositionKind {
  if (kind === undefined || kind === "" || kind === "scene") {
    return "scene";
  }
  if (kind === "alert") {
    return "alert";
  }
  throw new Error(`unknown composition kind ${JSON.stringify(kind)}`);
}

export function dbSceneToAlertComposition(s: scene.Scene): AlertComposition {
  if (compositionKindOf(s.kind) !== "alert") {
    throw new Error(`scene ${s.id} is not an alert`);
  }
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    widgetsJson: s.widgetsJson || "[]",
    layoutJson: s.layoutJson || "{}",
    behaviorsJson: s.behaviorsJson || "{}",
    inputsJson: s.inputsJson || "[]",
    hasDraft: s.hasDraft,
    createdByType: s.createdByType || "USER",
    createdByRef: s.createdByRef,
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
 * Narrow the engine's protobuf Command to the shared API CommandSnapshot.
 *
 * `actionsJson` is stored as JSON text (the same way a workflow stores its
 * steps) and decoded here, so every consumer receives the list rather than a
 * string it has to parse. Unreadable JSON decodes to no actions: a command
 * that cannot say what it runs runs nothing, which is visible in the UI,
 * rather than failing the whole listing it appears in.
 */
export function parseActions(actionsJson: string | undefined): ActionStep[] {
  if (!actionsJson) {
    return [];
  }
  try {
    const parsed = JSON.parse(actionsJson);
    return Array.isArray(parsed) ? (parsed as ActionStep[]) : [];
  } catch {
    return [];
  }
}

/**
 * A command's workflow tasks, decoded like its actions: unreadable JSON is no
 * steps rather than a failed listing.
 */
export function parseSteps(stepsJson: string | undefined): TaskDefinition[] {
  if (!stepsJson) {
    return [];
  }
  try {
    const parsed = JSON.parse(stepsJson);
    return Array.isArray(parsed) ? (parsed as TaskDefinition[]) : [];
  } catch {
    return [];
  }
}

export function commandToSnapshot(c: command.Command): CommandSnapshot {
  return {
    id: c.id,
    command: c.command,
    actions: parseActions(c.actionsJson),
    workflowId: c.workflowId ?? "",
    steps: parseSteps(c.stepsJson),
    cooldown: c.cooldown,
    priority: c.priority,
    enabled: c.enabled,
    visibility: (c.visibility || "restricted") as CommandSnapshot["visibility"],
    groupIds: c.groupIds ?? [],
    usernames: c.usernames ?? [],
    argumentPattern: c.argumentPattern ?? "",
  };
}

/**
 * Extract the catalog-facing fields the UI surfaces for an installed module
 * from the manifest JSON the engine stores on `modules.manifest`.
 *
 * `author` comes straight from the manifest authored by the module
 * developer and falls back to "Unknown" when missing, blank, or when the
 * stored manifest is malformed — the UI must always have a concrete string
 * to render. `taxonomy` is the manifest's `taxonomy` array when present;
 * otherwise a non-empty legacy `category` is folded into a single-element
 * list (clean cutover — mirrors moduleCatalogFields in
 * db/app/services/module_event_payload.go); otherwise an empty list.
 */
export function readModuleCatalogFields(rawManifest: string | undefined): {
  author: string;
  taxonomy: string[];
} {
  const fallback = { author: "Unknown", taxonomy: [] as string[] };
  if (!rawManifest) {
    return fallback;
  }
  let parsed: { author?: unknown; category?: unknown; taxonomy?: unknown } = {};
  try {
    const v = JSON.parse(rawManifest);
    if (v && typeof v === "object") {
      parsed = v as { author?: unknown; category?: unknown; taxonomy?: unknown };
    }
  } catch {
    return fallback;
  }
  const author = ((): string => {
    if (typeof parsed.author === "string") {
      const trimmed = parsed.author.trim();
      if (trimmed !== "") {
        return trimmed;
      }
    }
    return fallback.author;
  })();
  const taxonomy = ((): string[] => {
    if (Array.isArray(parsed.taxonomy)) {
      const entries = parsed.taxonomy.filter((x): x is string => typeof x === "string");
      if (entries.length > 0) {
        return entries;
      }
    }
    if (typeof parsed.category === "string") {
      const trimmed = parsed.category.trim();
      if (trimmed !== "") {
        return [trimmed];
      }
    }
    return fallback.taxonomy;
  })();
  return { author, taxonomy };
}
