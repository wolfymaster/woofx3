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
export const PLATFORM_EVENT_ENTRIES: ReadonlySet<string> = new Set(reservedSubjects.platformEventEntries);

function entryMatches(entry: string, subject: string): boolean {
  return entry.endsWith(".") ? subject.startsWith(entry) : subject === entry;
}

const NOT_A_SUBJECT_PROBLEM = "contains a wildcard, whitespace or a control character, which a subject cannot";

/** Must refuse what isSpaceOrControl in workflow/internal/engine/engine.go refuses. */
function isMalformedSubject(eventType: string): boolean {
  return /[*>\s\p{Cc}]/u.test(eventType);
}

/** Why a workflow cannot publish `eventType`, or null when it can. */
export function publishedEventTypeProblem(eventType: string): string | null {
  if (isMalformedSubject(eventType)) {
    return NOT_A_SUBJECT_PROBLEM;
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

export type TestEventKind = "trigger" | "simulate";

/**
 * Why the api will not publish `eventType` on behalf of a caller testing a
 * workflow, or null when it will. "trigger" is the generic path and refuses
 * every engine-reserved subject; "simulate" is the platform path and accepts
 * only platform events, since it stamps the platform on what it publishes.
 */
export function testEventProblem(kind: TestEventKind, eventType: string): string | null {
  if (eventType === "") {
    return "is empty";
  }
  if (kind === "trigger") {
    return publishedEventTypeProblem(eventType);
  }
  if (isMalformedSubject(eventType)) {
    return NOT_A_SUBJECT_PROBLEM;
  }
  const isPlatformEvent = [...PLATFORM_EVENT_ENTRIES].some((entry) => entryMatches(entry, eventType));
  return isPlatformEvent
    ? null
    : "is not a platform event, so it cannot be simulated; use triggerEvent for custom events";
}
