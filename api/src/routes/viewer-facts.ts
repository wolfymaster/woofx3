import type { ViewerFact } from "@woofx3/api";
import type * as viewer_fact from "@woofx3/db/viewer_fact.pb";
import { routeModule } from "./context";

/**
 * The keys of `${viewer.*}` that are not facts. Must match the reserved keys
 * in workflow/viewer_resolver.go, which never puts a fact under one of them.
 */
const VIEWER_KEYS: readonly ViewerFact[] = [
  { path: "id", name: "Viewer ID", description: "The viewer's id on their platform.", valueKind: "string" },
  { path: "platform", name: "Platform", description: "The platform the viewer is on.", valueKind: "string" },
  {
    path: "name",
    name: "Display name",
    description: "The viewer's display name, when the event or an earlier one carried it.",
    valueKind: "string",
  },
];

const RESERVED_OWNERS = new Set(VIEWER_KEYS.map((key) => key.path));
const VALUE_KINDS = new Set<ViewerFact["valueKind"]>(["string", "number", "timestamp"]);
const WINDOWS = new Set<NonNullable<ViewerFact["window"]>>(["lifetime", "session"]);

/**
 * Where `${viewer.*}` puts a fact, or null when it puts it nowhere. Mirrors
 * addFactValues in workflow/viewer_resolver.go: a fact `{owner}:fact:{slug}`
 * is at `{owner}.{slug}`, and an id of another shape, or one whose owner is a
 * reserved key, has no path.
 */
export function viewerFactPath(factId: string): string | null {
  const parts = factId.split(":");
  if (parts.length !== 3 || parts[0] === "" || parts[1] !== "fact" || parts[2] === "") {
    return null;
  }
  if (RESERVED_OWNERS.has(parts[0])) {
    return null;
  }
  return `${parts[0]}.${parts[2]}`;
}

/**
 * The facts `${viewer.*}` reads, in path order. Only an active definition is
 * read: the engine's viewer read returns active facts only, since one that
 * stopped counting holds a stale value.
 */
export function viewerFacts(definitions: readonly viewer_fact.FactDefinition[]): ViewerFact[] {
  const facts: ViewerFact[] = [];
  for (const definition of definitions) {
    if (definition.status !== "active") {
      continue;
    }
    const path = viewerFactPath(definition.id);
    const valueKind = definition.valueKind as ViewerFact["valueKind"];
    const window = definition.windowKind as NonNullable<ViewerFact["window"]>;
    if (path === null || !VALUE_KINDS.has(valueKind) || !WINDOWS.has(window)) {
      continue;
    }
    facts.push({ path, name: definition.name || path, description: definition.description, valueKind, window });
  }
  return facts.sort((a, b) => a.path.localeCompare(b.path));
}

export const viewerFactsRoutes = routeModule({
  async listViewerFacts(): Promise<ViewerFact[]> {
    const definitions = await this.db.listFactDefinitions();
    return [...VIEWER_KEYS.map((key) => ({ ...key })), ...viewerFacts(definitions)];
  },
});
