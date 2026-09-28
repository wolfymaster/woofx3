/**
 * Subject prefixes a workflow's `publish_event` step may not publish on, so
 * the api can refuse such a workflow when it is saved. The engine refuses it
 * too, on registration and at run time; this copy exists to give the author
 * the error at save time.
 *
 * Must match CommandSubjectPrefixes and EngineEventSubjectPrefixes in
 * shared/common/golang/cloudevents/reserved.go, which is the authority;
 * tests/workflow/reserved-subjects.test.ts compares them. Entries are raw
 * prefixes, as there.
 */
export const RESERVED_SUBJECT_PREFIXES: readonly string[] = [
  // CommandSubjectPrefixes
  "webhook.",
  "db.",
  "engine.",
  "slobs",
  "twitchapi",
  "message.send",
  "ui.notify.",
  "ui.alert.",
  "widget.queue.",
  "workflow.execute",
  "workflow.replay",
  "action.execute",
  // EngineEventSubjectPrefixes
  "HEARTBEAT",
  "MESSAGEBUS_INIT",
  "barkloader.",
  "channel.",
  "channelpoints.",
  "chat.command.",
  "module.",
  "reward",
  "session.",
  "setting.",
  "stream.offline",
  "stream.online",
  "user.message",
  "widget.event",
  "woofwoofwoof",
  "workflow.run.",
];

/** Why a workflow cannot publish `eventType`, or null when it can. */
export function publishedEventTypeProblem(eventType: string): string | null {
  if (/[*>\s]/.test(eventType)) {
    return "contains a wildcard or whitespace, which a subject cannot";
  }
  const prefix = RESERVED_SUBJECT_PREFIXES.find((p) => eventType.startsWith(p));
  if (prefix !== undefined) {
    return `is reserved for the engine (prefix ${JSON.stringify(prefix)})`;
  }
  return null;
}
