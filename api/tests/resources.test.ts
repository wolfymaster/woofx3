import { describe, expect, mock, test } from "bun:test";
import { resourcePublicUrl, resourceToItem, resourcesRoutes } from "../src/routes/resources";
import { registerAllRoutes } from "../src/routes/index";

const APPLICATION_ID = "app-1";
const BASE_URL = "http://127.0.0.1:9100";

function timestamp(seconds: number) {
  return { seconds: BigInt(seconds), nanos: 0 };
}

function readyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    applicationId: APPLICATION_ID,
    parentId: undefined,
    isFolder: false,
    name: "clip.png",
    kind: "image",
    contentType: "image/png",
    repositoryKey: "user/app-1/res-1/clip.png",
    thumbnailRepositoryKey: "",
    size: BigInt(2048),
    status: "ready",
    createdAt: timestamp(1_700_000_000),
    updatedAt: timestamp(1_700_000_000),
    ...overrides,
  };
}

/**
 * Build a host carrying only what the resource routes actually reach for.
 * The routes are plain objects mixed onto the Api class at registration,
 * so binding them to a stub is the same shape they run under in
 * production.
 */
function host(overrides: Record<string, unknown> = {}) {
  const stub = {
    overlayPublicUrl: "http://127.0.0.1:9100",
    ensureApplicationId: async () => APPLICATION_ID,
    logger: { info: mock(() => undefined), error: mock(() => undefined) },
    db: {},
    barkloaderRequest: mock(async (_path: string, _init?: RequestInit) => new Response("{}")),
    ...overrides,
  };
  return Object.assign(stub, resourcesRoutes) as typeof stub & typeof resourcesRoutes;
}

describe("resource wire mapping", () => {
  test("derives public urls from repository keys", () => {
    const item = resourceToItem(BASE_URL, readyRow({ thumbnailRepositoryKey: "user/app-1/res-1/thumbnail.png" }) as never);

    expect(item.url).toBe("http://127.0.0.1:9100/overlay/assets/user/app-1/res-1/clip.png");
    expect(item.thumbnailUrl).toBe("http://127.0.0.1:9100/overlay/assets/user/app-1/res-1/thumbnail.png");
    expect(item.size).toBe(2048);
    expect(item.parentId).toBeNull();
  });

  test("a resource without a generated thumbnail reports none", () => {
    const item = resourceToItem(BASE_URL, readyRow() as never);

    expect(item.url).not.toBeNull();
    expect(item.thumbnailUrl).toBeNull();
  });

  test("a pending resource serves no url until its bytes land", () => {
    const item = resourceToItem(BASE_URL, readyRow({ status: "pending", repositoryKey: "user/app-1/res-1/clip.png" }) as never);

    expect(item.status).toBe("pending");
    expect(item.url).toBeNull();
  });

  test("folders carry no url", () => {
    const item = resourceToItem(BASE_URL, 
      readyRow({ isFolder: true, kind: "folder", repositoryKey: "", contentType: "" }) as never,
    );

    expect(item.isFolder).toBe(true);
    expect(item.url).toBeNull();
  });

  test("a trailing slash on the public base does not double up", () => {
    expect(resourcePublicUrl("http://example.test/", "user/a/b/c.png")).toBe(
      "http://example.test/overlay/assets/user/a/b/c.png",
    );
  });
});

describe("listResources", () => {
  test("returns only stored resources, never a thumbnail as its own entry", async () => {
    const rows = [
      readyRow({ id: "res-1", thumbnailRepositoryKey: "user/app-1/res-1/thumbnail.png" }),
      readyRow({ id: "res-2", name: "song.mp3", kind: "audio", contentType: "audio/mpeg" }),
    ];
    const api = host({
      db: {
        listResources: mock(async (_req: any) => ({
          resources: rows,
          total: 2,
          page: 1,
          pageSize: 50,
        })),
      },
    });

    const result = await api.listResources();

    expect(result.total).toBe(2);
    expect(result.resources.map((r) => r.id)).toEqual(["res-1", "res-2"]);
    // The thumbnail is a field on res-1, not a third row.
    expect(result.resources).toHaveLength(2);
    expect(result.resources[0]?.thumbnailUrl).toContain("thumbnail.png");
  });

  test("scopes to a folder when one is given", async () => {
    const listResources = mock(async (_req: any) => ({ resources: [], total: 0, page: 1, pageSize: 50 }));
    const api = host({ db: { listResources } });

    await api.listResources({ folderId: "folder-9", kind: "image" });

    expect(listResources).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: APPLICATION_ID, parentId: "folder-9", kind: "image" }),
    );
  });
});

describe("requestUploadUrl", () => {
  test("reserves a row, then asks barkloader for a grant keyed on its id", async () => {
    const createResource = mock(async (_req: any) => readyRow({ status: "pending", repositoryKey: "" }));
    const updateResource = mock(async (_req: any) => readyRow({ status: "pending" }));
    const barkloaderRequest = mock(
      async (_path: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            repositoryKey: "user/app-1/res-1/clip.png",
            uploadUrl: "http://storage.test/put",
            method: "PUT",
            headers: [{ name: "Content-Type", value: "image/png" }],
            expiresAt: 1_700_000_300,
          }),
        ),
    );
    const api = host({ db: { createResource, tryUpdateResource: updateResource }, barkloaderRequest });

    const grant = await api.requestUploadUrl({ name: "clip.png", contentType: "image/png" });

    expect(createResource).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", kind: "image", contentType: "image/png" }),
    );
    const [path, init] = barkloaderRequest.mock.calls[0];
    expect(path).toBe("/assets/upload-url");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      application_id: APPLICATION_ID,
      resource_id: "res-1",
      file_name: "clip.png",
    });
    // The issued key is written back so the row can be resolved to bytes.
    expect(updateResource).toHaveBeenCalledWith(
      expect.objectContaining({ id: "res-1", repositoryKey: "user/app-1/res-1/clip.png" }),
    );
    expect(grant.uploadUrl).toBe("http://storage.test/put");
    expect(grant.expiresAt).toBe(1_700_000_300);
  });

  test("classifies kind from the content type", async () => {
    const createResource = mock(async (_req: any) => readyRow({ status: "pending", repositoryKey: "" }));
    const api = host({
      db: { createResource, tryUpdateResource: mock(async (_req: any) => readyRow()) },
      barkloaderRequest: mock(
        async () => new Response(JSON.stringify({ repositoryKey: "k", uploadUrl: "u", method: "PUT", headers: [], expiresAt: 0 })),
      ),
    });

    await api.requestUploadUrl({ name: "a.mp4", contentType: "video/mp4" });
    await api.requestUploadUrl({ name: "b.mp3", contentType: "audio/mpeg" });
    await api.requestUploadUrl({ name: "c.bin", contentType: "application/octet-stream" });

    const kinds = createResource.mock.calls.map((call) => (call[0] as { kind: string }).kind);
    expect(kinds).toEqual(["video", "audio", "other"]);
  });

  test("rejects a nameless upload before reserving anything", async () => {
    const createResource = mock(async (_req: any) => (readyRow()));
    const api = host({ db: { createResource } });

    await expect(api.requestUploadUrl({ name: "", contentType: "image/png" })).rejects.toThrow("name is required");
    expect(createResource).not.toHaveBeenCalled();
  });
});

describe("folders", () => {
  test("createFolder passes the parent through", async () => {
    const createResourceFolder = mock(async (_req: any) => readyRow({ isFolder: true, kind: "folder", name: "clips", repositoryKey: "" }));
    const api = host({ db: { createResourceFolder } });

    const folder = await api.createFolder("clips", "parent-1");

    expect(createResourceFolder).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: APPLICATION_ID, name: "clips", parentId: "parent-1" }),
    );
    expect(folder.isFolder).toBe(true);
  });

  test("moving to the root sends an empty parent rather than omitting it", async () => {
    const updateResource = mock(async (_req: any) => (readyRow()));
    const api = host({ db: { updateResource } });

    await api.updateResource("res-1", { parentId: null });

    // Absent means "leave alone"; present-but-empty means "move to root".
    expect(updateResource).toHaveBeenCalledWith(expect.objectContaining({ id: "res-1", parentId: "" }));
  });

  test("a rename leaves the parent untouched", async () => {
    const updateResource = mock(async (_req: any) => (readyRow()));
    const api = host({ db: { updateResource } });

    await api.updateResource("res-1", { name: "renamed.png" });

    const request = updateResource.mock.calls[0]?.[0] as { name?: string; parentId?: string };
    expect(request.name).toBe("renamed.png");
    expect(request.parentId).toBeUndefined();
  });
});

describe("deleteResource", () => {
  test("purges the stored objects db-proxy reports", async () => {
    const deleteResource = mock(async (_req: any) => ([
        "user/app-1/res-1/clip.png",
        "user/app-1/res-1/thumbnail.png",
        "user/app-1/res-2/other.png",
    ]));
    const barkloaderRequest = mock(async (_path: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    const api = host({ db: { deleteResource }, barkloaderRequest });

    await api.deleteResource("res-1");

    // Two distinct resource directories, not three keys: the thumbnail
    // shares a prefix with the upload it was derived from.
    const paths = barkloaderRequest.mock.calls.map((call) => call[0]);
    expect(paths).toEqual(["/assets/resource/app-1/res-1", "/assets/resource/app-1/res-2"]);
  });

  test("a storage purge failure does not fail the delete", async () => {
    const api = host({
      db: {
        deleteResource: mock(async (_req: any) => (["user/app-1/res-1/clip.png"])),
      },
      barkloaderRequest: mock(async (_path: string, _init?: RequestInit) => {
        throw new Error("storage unreachable");
      }),
    });

    // The rows are already gone; reporting failure would invite a retry
    // that cannot fix anything.
    expect(await api.deleteResource("res-1")).toEqual({ deleted: true });
  });
});

describe("processing", () => {
  test("requestProcessing hands barkloader a callback and the row to echo back", async () => {
    const barkloaderRequest = mock(async (_path: string, _init?: RequestInit) => new Response("{}"));
    const api = host({
      db: { getResource: mock(async (_req: any) => (readyRow())) },
      barkloaderRequest,
    });

    await api.requestProcessing("res-1");

    const [path, init] = barkloaderRequest.mock.calls[0];
    expect(path).toBe("/assets/process");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      repository_key: "user/app-1/res-1/clip.png",
      utility: "thumbnail",
      resource_id: "res-1",
      callback_url: "http://127.0.0.1:9100/webhooks/barkloader/processing",
    });
  });

  test("refuses a utility that is not implemented", async () => {
    const api = host();
    await expect(api.requestProcessing("res-1", "transcode")).rejects.toThrow("Unsupported processing utility");
  });

  test("refuses a resource with no stored object", async () => {
    const api = host({
      db: {
        getResource: mock(async (_req: any) => (readyRow({ repositoryKey: "" }))),
      },
    });
    await expect(api.requestProcessing("res-1")).rejects.toThrow("no stored object");
  });

  test("a completed job records the thumbnail key", async () => {
    const updateResource = mock(async (_req: any) => (readyRow()));
    const api = host({ db: { updateResource } });

    await api.handleProcessingCallback({
      resource_id: "res-1",
      repository_key: "user/app-1/res-1/clip.png",
      utility: "thumbnail",
      status: "completed",
      thumbnail_repository_key: "user/app-1/res-1/thumbnail.png",
    });

    expect(updateResource).toHaveBeenCalledWith(
      expect.objectContaining({ id: "res-1", thumbnailRepositoryKey: "user/app-1/res-1/thumbnail.png" }),
    );
  });

  test("not_applicable is a success that writes nothing", async () => {
    const updateResource = mock(async (_req: any) => (readyRow()));
    const api = host({ db: { updateResource } });

    // Audio has no frame to render. Recording a failure here would put a
    // retry loop behind something that can never succeed.
    await api.handleProcessingCallback({
      resource_id: "res-1",
      repository_key: "user/app-1/res-1/song.mp3",
      utility: "thumbnail",
      status: "not_applicable",
      reason: "audio has no renderable frame",
    });

    expect(updateResource).not.toHaveBeenCalled();
  });

  test("a failed job leaves the row untouched", async () => {
    const updateResource = mock(async (_req: any) => (readyRow()));
    const api = host({ db: { updateResource } });

    await api.handleProcessingCallback({
      resource_id: "res-1",
      utility: "thumbnail",
      status: "failed",
      error: "ffmpeg exited 1",
    });

    expect(updateResource).not.toHaveBeenCalled();
  });

  test("a callback with no resource id is dropped rather than throwing", async () => {
    const updateResource = mock(async (_req: any) => (readyRow()));
    const api = host({ db: { updateResource } });

    await api.handleProcessingCallback({ status: "completed", thumbnail_repository_key: "k" });

    expect(updateResource).not.toHaveBeenCalled();
  });
});

describe("registered route surface", () => {
  // The other suites assign the raw module onto a stub, which skips the
  // span wrapper that registerAllRoutes applies. That wrapper returns a
  // Promise from every function it wraps, so a synchronous helper left on
  // the routes object would silently start returning a Promise -- and the
  // mapped url would reach the UI as "[object Promise]". Go through real
  // registration so that cannot regress unnoticed.
  test("the mappers are not registered as RPC methods", () => {
    const registered: Record<string, unknown> = {
      overlayPublicUrl: BASE_URL,
      logger: { info: mock(() => undefined), error: mock(() => undefined) },
    };
    registerAllRoutes(registered as never);

    expect(registered.resourceToItem).toBeUndefined();
    expect(registered.resourcePublicUrl).toBeUndefined();
  });

  test("every registered resource route is async, so the span wrapper cannot change its shape", () => {
    for (const [name, value] of Object.entries(resourcesRoutes)) {
      if (typeof value !== "function") {
        continue;
      }
      expect(`${name}:${value.constructor.name}`).toBe(`${name}:AsyncFunction`);
    }
  });

  test("a mapped resource carries plain string urls, not promises", () => {
    const item = resourceToItem(BASE_URL, readyRow() as never);
    expect(typeof item.url).toBe("string");
    expect(item.url).not.toContain("[object Promise]");
  });
});
