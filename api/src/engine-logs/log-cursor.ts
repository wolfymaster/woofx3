export interface LogPosition {
  file: string;
  offset: number;
}

/** `<file>:<offset>`; the file name never contains a colon, so the last one splits. */
export function encodeLogPosition(position: LogPosition): string {
  return `${position.file}:${position.offset}`;
}

/** A malformed cursor is a caller error, not "start from the top". */
export function decodeLogPosition(cursor: string): LogPosition {
  const split = cursor.lastIndexOf(":");
  const offset = Number(cursor.slice(split + 1));
  if (split <= 0 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("cursor is not a log position");
  }
  return { file: cursor.slice(0, split), offset };
}
