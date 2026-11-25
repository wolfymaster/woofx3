/**
 * Parses the `key=value,key=value` syntax of OTEL_RESOURCE_ATTRIBUTES and
 * OTEL_EXPORTER_OTLP_HEADERS. A malformed pair throws rather than being
 * skipped: a dropped auth header or engine tag would ship telemetry
 * unauthenticated or unattributed with nothing to show for it.
 *
 * Keys and values are percent-decoded after splitting, as in the standard
 * syntax, so `Basic%20abc` and an encoded comma survive.
 */
export function parseOtelPairs(raw: string | undefined, envName: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  if (raw === undefined) {
    return pairs;
  }
  for (const segment of raw.split(",")) {
    const trimmed = segment.trim();
    if (trimmed === "") {
      continue;
    }
    const separator = trimmed.indexOf("=");
    const key = separator === -1 ? "" : trimmed.slice(0, separator).trim();
    if (key === "") {
      // The segment is never echoed: for headers it may hold a credential.
      throw new Error(`${envName} must be comma-separated key=value pairs; a pair has no key`);
    }
    try {
      pairs[decodeURIComponent(key)] = decodeURIComponent(trimmed.slice(separator + 1).trim());
    } catch {
      throw new Error(`${envName} has an invalid percent-escape`);
    }
  }
  return pairs;
}
