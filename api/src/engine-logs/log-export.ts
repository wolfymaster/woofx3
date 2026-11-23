import { open } from "node:fs/promises";
import { Zip, ZipDeflate } from "fflate";
import type { LogFile } from "./log-files";

const READ_BYTES = 256 * 1024;

/**
 * A zip of the given files as a byte stream, written as it is read so a
 * large log directory is never held in memory. Entries are named by their
 * file name only, which `listLogFiles` already guarantees has no path part.
 */
export function zipLogFiles(files: LogFile[]): ReadableStream<Uint8Array> {
  const chunks = zipChunks(files);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

async function* zipChunks(files: LogFile[]): AsyncGenerator<Uint8Array> {
  const pending: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error !== null) {
      failure = error;
      return;
    }
    pending.push(chunk);
  });
  const drain = function* (): Generator<Uint8Array> {
    if (failure !== null) {
      throw failure;
    }
    while (pending.length > 0) {
      yield pending.shift() as Uint8Array;
    }
  };

  for (const file of files) {
    const entry = new ZipDeflate(file.name);
    zip.add(entry);
    const handle = await open(file.path, "r");
    try {
      const buffer = Buffer.alloc(READ_BYTES);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, READ_BYTES, null);
        if (bytesRead === 0) {
          break;
        }
        entry.push(new Uint8Array(buffer.subarray(0, bytesRead)));
        yield* drain();
      }
    } finally {
      await handle.close();
    }
    entry.push(new Uint8Array(0), true);
    yield* drain();
  }
  zip.end();
  yield* drain();
}
