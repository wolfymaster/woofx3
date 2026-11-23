import { open } from "node:fs/promises";

const CHUNK_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

export interface FileLine {
  text: string;
  /** Byte offset of the first byte of the line. */
  offset: number;
  /** Byte offset one past the line's last byte, its newline included when it has one. */
  end: number;
}

/**
 * Reads the lines that start before `endOffset`, last line first, without
 * reading the file from the start. Splits on raw newline bytes before decoding,
 * so a multi-byte character cut by a chunk edge is never decoded half.
 * `endOffset` must be the start of a line or the file size.
 */
export async function* readLinesBackward(path: string, endOffset: number): AsyncGenerator<FileLine> {
  const handle = await open(path, "r");
  try {
    let position = endOffset;
    let carry: Buffer = Buffer.alloc(0);
    let carryEnd = endOffset;
    while (position > 0) {
      const size = Math.min(CHUNK_BYTES, position);
      position -= size;
      const chunk = Buffer.alloc(size);
      await handle.read(chunk, 0, size, position);
      const buffer = Buffer.concat([chunk, carry]);
      let lineEnd = buffer.length;
      let nextEnd = carryEnd;
      let sawNewline = false;
      while (lineEnd > 0) {
        const newline = buffer.lastIndexOf(NEWLINE, lineEnd - 1);
        if (newline === -1) {
          break;
        }
        sawNewline = true;
        const start = newline + 1;
        if (lineEnd > start) {
          yield lineAt(buffer, start, lineEnd, position, nextEnd);
        }
        nextEnd = position + start;
        lineEnd = newline;
      }
      carry = buffer.subarray(0, lineEnd);
      // The carried bytes are the start of a line whose end is the newline just found, or still the buffer's end.
      carryEnd = sawNewline ? position + lineEnd + 1 : carryEnd;
    }
    if (carry.length > 0) {
      yield lineAt(carry, 0, carry.length, 0, carryEnd);
    }
  } finally {
    await handle.close();
  }
}

function lineAt(buffer: Buffer, start: number, lineEnd: number, base: number, end: number): FileLine {
  const text = buffer.toString("utf8", start, lineEnd).replace(/\r$/, "");
  return { text, offset: base + start, end };
}

/**
 * Reads complete lines in `[from, to)`. `from` must be a line start. Returns
 * the lines and the offset after the last complete one, so the caller resumes
 * there and a line still being written is picked up whole next time.
 */
export async function readLinesForward(
  path: string,
  from: number,
  to: number
): Promise<{ lines: FileLine[]; next: number }> {
  if (to <= from) {
    return { lines: [], next: from };
  }
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(to - from);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
    const data = buffer.subarray(0, bytesRead);
    const lines: FileLine[] = [];
    let start = 0;
    for (let newline = data.indexOf(NEWLINE); newline !== -1; newline = data.indexOf(NEWLINE, start)) {
      if (newline > start) {
        lines.push({
          text: data.toString("utf8", start, newline).replace(/\r$/, ""),
          offset: from + start,
          end: from + newline + 1,
        });
      }
      start = newline + 1;
    }
    return { lines, next: from + start };
  } finally {
    await handle.close();
  }
}
