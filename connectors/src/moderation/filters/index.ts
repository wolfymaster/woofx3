import type { ModerationFilter } from "../types";
import { bannedPhrasesFilter, capsFilter, repetitionFilter, symbolsFilter } from "./content";
import { linksFilter } from "./links";

/** Every shipped filter, for filterRegistry. */
export const MODERATION_FILTERS: readonly ModerationFilter[] = [
  bannedPhrasesFilter,
  linksFilter,
  repetitionFilter,
  capsFilter,
  symbolsFilter,
];
