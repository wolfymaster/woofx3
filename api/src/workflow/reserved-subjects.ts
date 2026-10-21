import reservedSubjects from "@woofx3/contracts/reserved-subjects.json";

/**
 * Subject prefixes a workflow's `publish_event` step may not publish on, so
 * the api can refuse such a workflow when it is saved. The engine refuses it
 * too, on registration and at run time; this check exists to give the author
 * the error at save time.
 *
 * Read from shared/common/contracts/reserved-subjects.json, the list the
 * engine and barkloader enforce. As there, an entry ending in "." reserves
 * that namespace and any other entry exactly that name.
 */
export const RESERVED_SUBJECT_PREFIXES: readonly string[] = [
  ...reservedSubjects.commandSubjectPrefixes,
  ...reservedSubjects.engineAssertedPrefixes,
];

/** Reservations holding platform events, which a creator can fire with simulateTwitchEvent instead. */
const PLATFORM_EVENT_ENTRIES: ReadonlySet<string> = new Set(reservedSubjects.platformEventEntries);

function entryMatches(entry: string, subject: string): boolean {
  return entry.endsWith(".") ? subject.startsWith(entry) : subject === entry;
}

/** Why a workflow cannot publish `eventType`, or null when it can. */
export function publishedEventTypeProblem(eventType: string): string | null {
  // Must refuse what isSpaceOrControl in workflow/internal/engine/engine.go refuses.
  if (/[*>\s\p{Cc}]/u.test(eventType)) {
    return "contains a wildcard, whitespace or a control character, which a subject cannot";
  }
  const entry = RESERVED_SUBJECT_PREFIXES.find((e) => entryMatches(e, eventType));
  if (entry === undefined) {
    return null;
  }
  if (PLATFORM_EVENT_ENTRIES.has(entry)) {
    return `is reserved for the engine (${JSON.stringify(entry)}); to test a workflow against a platform event, fire it with simulateTwitchEvent`;
  }
  return `is reserved for the engine (${JSON.stringify(entry)})`;
}
