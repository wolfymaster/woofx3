import { FILTER_IDS, type FilterId } from "@woofx3/api/moderation-config";
import type { ModerationFilter } from "./types";

/** Every filter, keyed by id: the one place filters are listed. */
export type FilterRegistry = Readonly<Record<FilterId, ModerationFilter>>;

/**
 * The registry for `filters`, which must name every FilterId exactly once.
 * A filter's params type is erased here; the config parser keeps each rule's
 * params paired with the filter that parsed them.
 */
export function filterRegistry(filters: readonly ModerationFilter[]): FilterRegistry {
  const byId = new Map<FilterId, ModerationFilter>();
  for (const filter of filters) {
    if (byId.has(filter.id)) {
      throw new Error(`moderation filter "${filter.id}" is registered twice`);
    }
    byId.set(filter.id, filter);
  }
  const missing = FILTER_IDS.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`moderation filters missing from the registry: ${missing.join(", ")}`);
  }
  return Object.fromEntries(byId) as Record<FilterId, ModerationFilter>;
}
