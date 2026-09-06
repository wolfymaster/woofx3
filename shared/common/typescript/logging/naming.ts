/**
 * Shared file-naming for everything this package writes under `logDir`.
 * Kept in its own leaf module so both the pino file stream and the local
 * trace exporter derive their names from one place.
 */

function makeTimestampSuffix(now: Date): string {
  const year = now.getFullYear().toString().padStart(4, "0");
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const hour = now.getHours().toString().padStart(2, "0");
  const minute = now.getMinutes().toString().padStart(2, "0");
  return `${year}${month}${day}_${hour}${minute}`;
}

export function makeLogFileName(serviceName: string, now: Date): string {
  return `${serviceName}_${makeTimestampSuffix(now)}.log`;
}

export function makeTraceFileName(serviceName: string, now: Date): string {
  return `${serviceName}_traces_${makeTimestampSuffix(now)}.log`;
}
