import { describe, expect, test } from "bun:test";
import { MODULE_FILE_TEXT_LIMIT_BYTES, type ModuleFileContent, type ModuleFileList } from "@woofx3/api";
import { classifyModuleFile, moduleArchiveKey, modulesRoutes } from "../src/routes/modules";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

const encode = (text: string) => new TextEncoder().encode(text);

interface FakeModule {
  moduleId: string;
  archiveKey: string;
  moduleKey: string;
}

/**
 * A route host whose barkloader answers from `archives`: archive key to the
 * files it holds. A missing archive or file answers null, the way
 * `barkloaderRequestOrNull` reports a 404.
 */
function host(modules: FakeModule[], archives: Record<string, Record<string, Uint8Array>>) {
  const requested: string[] = [];
  return {
    requested,
    self: {
      logger: fakeLogger(),
      db: { listModules: async () => modules },
      async barkloaderRequestOrNull(path: string): Promise<Response | null> {
        requested.push(path);
        const url = new URL(path, "http://barkloader");
        const archive = archives[url.searchParams.get("key") ?? ""];
        if (!archive) {
          return null;
        }
        if (url.pathname === "/archives/files") {
          const files = Object.entries(archive)
            .map(([p, bytes]) => ({ path: p, size: bytes.byteLength }))
            .sort((a, b) => a.path.localeCompare(b.path));
          return Response.json(files);
        }
        const bytes = archive[url.searchParams.get("path") ?? ""];
        if (!bytes) {
          return null;
        }
        return new Response(bytes as Uint8Array<ArrayBuffer>, {
          headers: { "X-Archive-Entry-Size": String(bytes.byteLength) },
        });
      },
    },
  };
}

function listModuleFiles(self: unknown, moduleId: string): Promise<ModuleFileList> {
  const route = modulesRoutes.listModuleFiles as unknown as (id: string) => Promise<ModuleFileList>;
  return route.call(self, moduleId);
}

function getModuleFile(self: unknown, moduleId: string, path: string): Promise<ModuleFileContent> {
  const route = modulesRoutes.getModuleFile as unknown as (id: string, p: string) => Promise<ModuleFileContent>;
  return route.call(self, moduleId, path);
}

const DEMO: FakeModule = {
  moduleId: "demo",
  archiveKey: "archives/demo:1.0.0:abc1234.zip",
  moduleKey: "demo:1.0.0:abc1234",
};

describe("classifyModuleFile", () => {
  test("reads valid UTF-8 as text", () => {
    expect(classifyModuleFile("README.md", encode("# Hi \u{1F436}"), 9)).toEqual({
      path: "README.md",
      size: 9,
      kind: "text",
      content: "# Hi \u{1F436}",
    });
  });

  test("reads an empty file as empty text", () => {
    expect(classifyModuleFile("empty.js", new Uint8Array(), 0)).toEqual({
      path: "empty.js",
      size: 0,
      kind: "text",
      content: "",
    });
  });

  test("calls a NUL byte binary even when the rest is valid UTF-8", () => {
    expect(classifyModuleFile("a.bin", new Uint8Array([0x61, 0x00, 0x62]), 3).kind).toBe("binary");
  });

  test("calls invalid UTF-8 binary", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(classifyModuleFile("icon.png", png, 8)).toEqual({ path: "icon.png", size: 8, kind: "binary" });
  });

  test("reads text at exactly the limit as text", () => {
    const bytes = new Uint8Array(MODULE_FILE_TEXT_LIMIT_BYTES).fill(0x61);
    expect(classifyModuleFile("big.js", bytes, bytes.byteLength).kind).toBe("text");
  });

  test("calls text past the limit too_large, with the declared size", () => {
    const bytes = new Uint8Array(MODULE_FILE_TEXT_LIMIT_BYTES + 1).fill(0x61);
    expect(classifyModuleFile("big.js", bytes, 5_000_000)).toEqual({
      path: "big.js",
      size: 5_000_000,
      kind: "too_large",
    });
  });

  test("does not mistake a character the cap split in two for binary", () => {
    // Three-byte characters: the cap at limit+1 bytes lands mid-character.
    const text = encode("€".repeat(Math.ceil((MODULE_FILE_TEXT_LIMIT_BYTES + 1) / 3) + 1));
    const capped = text.slice(0, MODULE_FILE_TEXT_LIMIT_BYTES + 1);
    expect(classifyModuleFile("euro.txt", capped, text.byteLength).kind).toBe("too_large");
  });

  test("calls a large binary file binary, not too_large", () => {
    const bytes = new Uint8Array(MODULE_FILE_TEXT_LIMIT_BYTES + 1);
    expect(classifyModuleFile("clip.mp4", bytes, 9_000_000).kind).toBe("binary");
  });

  test("never reports less than the bytes it was given", () => {
    expect(classifyModuleFile("a.txt", encode("hello"), 2).size).toBe(5);
  });
});

describe("moduleArchiveKey", () => {
  test("prefers the key the row records", () => {
    expect(moduleArchiveKey({ archiveKey: "archives/x.zip", moduleKey: "demo:1:abc" })).toBe("archives/x.zip");
  });

  test("falls back to the key barkloader stores archives under", () => {
    expect(moduleArchiveKey({ archiveKey: "", moduleKey: "demo:1:abc" })).toBe("archives/demo:1:abc.zip");
  });

  test("is empty when neither is known", () => {
    expect(moduleArchiveKey({ archiveKey: "", moduleKey: "" })).toBe("");
  });
});

describe("listModuleFiles", () => {
  test("lists the files of the module's archive", async () => {
    const { self, requested } = host([DEMO], {
      [DEMO.archiveKey]: { "manifest.json": encode("{}"), "functions/hello.js": encode("1;") },
    });
    expect(await listModuleFiles(self, "demo")).toEqual({
      available: true,
      files: [
        { path: "functions/hello.js", size: 2 },
        { path: "manifest.json", size: 2 },
      ],
    });
    expect(requested).toEqual([`/archives/files?key=${encodeURIComponent(DEMO.archiveKey)}`]);
  });

  test("is unavailable when no archive is stored", async () => {
    const { self } = host([DEMO], {});
    expect(await listModuleFiles(self, "demo")).toEqual({ available: false, files: [] });
  });

  test("is unavailable without asking barkloader when no archive key is known", async () => {
    const { self, requested } = host([{ moduleId: "legacy", archiveKey: "", moduleKey: "" }], {});
    expect(await listModuleFiles(self, "legacy")).toEqual({ available: false, files: [] });
    expect(requested).toEqual([]);
  });

  test("throws for a module that is not installed", async () => {
    const { self } = host([DEMO], {});
    await expect(listModuleFiles(self, "nope")).rejects.toThrow('no module found for moduleId "nope"');
  });
});

describe("getModuleFile", () => {
  test("returns a text file's content", async () => {
    const { self } = host([DEMO], { [DEMO.archiveKey]: { "functions/hello.js": encode("export default 1;") } });
    expect(await getModuleFile(self, "demo", "functions/hello.js")).toEqual({
      path: "functions/hello.js",
      size: 17,
      kind: "text",
      content: "export default 1;",
    });
  });

  test("returns a binary file without content", async () => {
    const { self } = host([DEMO], { [DEMO.archiveKey]: { "assets/a.png": new Uint8Array([0x89, 0x00, 0xff]) } });
    expect(await getModuleFile(self, "demo", "assets/a.png")).toEqual({
      path: "assets/a.png",
      size: 3,
      kind: "binary",
    });
  });

  test("throws file not found for a path the archive does not hold", async () => {
    const { self } = host([DEMO], { [DEMO.archiveKey]: {} });
    await expect(getModuleFile(self, "demo", "nope.js")).rejects.toThrow("file not found in module: nope.js");
  });

  test("throws for a module that is not installed", async () => {
    const { self } = host([DEMO], {});
    await expect(getModuleFile(self, "nope", "manifest.json")).rejects.toThrow('no module found for moduleId "nope"');
  });
});
