import { describe, expect, mock, test } from "bun:test";
import { registerAllRoutes } from "../src/routes/index";
import { resourcePublicUrl, resourcesRoutes, resourceToItem } from "../src/routes/resources";

const BASE_URL = "http://127.0.0.1:9100";

function timestamp(seconds: number) {
  return { seconds: BigInt(seconds), nanos: 0 };
}

function readyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    parentId: undefined,
    isFolder: false,
    name: "clip.png",
    kind: "image",
    contentType: "image/png",
    repositoryKey: "user/res-1/clip.png",
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
  const { db, ...rest } = overrides;
  const stub = {
    sceneManagerUrl: "http://127.0.0.1:9101",
    apiUrl: "http://127.0.0.1:9100",
    logger: { info: mock(() => undefined), error: mock(() => undefined) },
    barkloaderRequest: mock(async (_path: string, _init?: RequestInit) => new Response("{}")),
    ...rest,
    db: { getSetting: mock(async (_key: string) => ""), ...(db as object | undefined) },
  };
  return Object.assign(stub, resourcesRoutes) as typeof stub & typeof resourcesRoutes;
}

describe("resource wire mapping", () => {
  test("derives public urls from repository keys", () => {
    const item = resourceToItem(BASE_URL, readyRow({ thumbnailRepositoryKey: "user/res-1/thumbnail.png" }) as never);

    expect(item.url).toBe("http://127.0.0.1:9100/assets/user/res-1/clip.png");
    expect(item.thumbnailUrl).toBe("http://127.0.0.1:9100/assets/user/res-1/thumbnail.png");
    expect(item.size).toBe(2048);
    expect(item.parentId).toBeNull();
  });

  test("a resource without a generated thumbnail reports none", () => {
    const item = resourceToItem(BASE_URL, readyRow() as never);

    expect(item.url).not.toBeNull();
    expect(item.thumbnailUrl).toBeNull();
  });

  test("a pending resource serves no url until its bytes land", () => {
    const item = resourceToItem(
      BASE_URL,
      readyRow({ status: "pending", repositoryKey: "user/res-1/clip.png" }) as never
    );

    expect(item.status).toBe("pending");
    expect(item.url).toBeNull();
  });

  test("folders carry no url", () => {
    const item = resourceToItem(
      BASE_URL,
      readyRow({ isFolder: true, kind: "folder", repositoryKey: "", contentType: "" }) as never
    );

    expect(item.isFolder).toBe(true);
    expect(item.url).toBeNull();
  });

  test("a module archive carries no url even once ready", () => {
    const item = resourceToItem(
      BASE_URL,
      readyRow({
        kind: "custom_module",
        contentType: "application/zip",
        repositoryKey: "user/custom-modules/res-1/shoutout.zip",
        thumbnailRepositoryKey: "user/custom-modules/res-1/thumbnail.png",
      }) as never
    );

    expect(item.kind).toBe("custom_module");
    expect(item.status).toBe("ready");
    expect(item.url).toBeNull();
    expect(item.thumbnailUrl).toBeNull();
  });

  test("a trailing slash on the public base does not double up", () => {
    expect(resourcePublicUrl("http://example.test/", "user/a/b/c.png")).toBe(
      "http://example.test/assets/user/a/b/c.png"
    );
  });
});

describe("listResources", () => {
  test("returns only stored resources, never a thumbnail as its own entry", async () => {
    const rows = [
      readyRow({ id: "res-1", thumbnailRepositoryKey: "user/res-1/thumbnail.png" }),
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

  test("passes no kind through when none is asked for, which db-proxy reads as everything but modules", async () => {
    const listResources = mock(async (_req: any) => ({ resources: [], total: 0, page: 1, pageSize: 50 }));
    const api = host({ db: { listResources } });

    await api.listResources();
    await api.listResources({ kind: "custom_module" });

    expect(listResources.mock.calls[0]?.[0]).toMatchObject({ kind: "" });
    expect(listResources.mock.calls[1]?.[0]).toMatchObject({ kind: "custom_module" });
  });

  test("scopes to a folder when one is given", async () => {
    const listResources = mock(async (_req: any) => ({ resources: [], total: 0, page: 1, pageSize: 50 }));
    const api = host({ db: { listResources } });

    await api.listResources({ folderId: "folder-9", kind: "image" });

    expect(listResources).toHaveBeenCalledWith(expect.objectContaining({ parentId: "folder-9", kind: "image" }));
  });
});

describe("public urls", () => {
  test("follow the scene.publicUrl setting over the configured default", async () => {
    const getSetting = mock(async (_key: string) => "https://scene.example.test/");
    const api = host({ db: { getSetting, getResource: mock(async (_req: any) => readyRow()) } });

    const item = await api.getResource("res-1");

    expect(getSetting).toHaveBeenCalledWith("scene.publicUrl");
    expect(item.url).toBe("https://scene.example.test/assets/user/res-1/clip.png");
  });
});

/** The fields of a createResource request these tests read back. */
type CreateResourceArgs = { id: string; kind: string; repositoryKey: string };

/**
 * Stand in for barkloader's upload-url endpoint: the key it issues is built
 * from the ids the caller sent, exactly as `user_resource_key` does.
 */
function grantingBarkloader() {
  return mock(async (_path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { resource_id: string; file_name: string; area: string };
    const directory = body.area === "custom_module" ? "user/custom-modules" : "user";
    return new Response(
      JSON.stringify({
        repositoryKey: `${directory}/${body.resource_id}/${body.file_name}`,
        uploadUrl: "http://storage.test/put",
        method: "PUT",
        headers: [{ name: "Content-Type", value: "image/png" }],
        expiresAt: 1_700_000_300,
      })
    );
  });
}

describe("requestUploadUrl", () => {
  test("mints the id, obtains a grant keyed on it, then creates the row holding that key", async () => {
    const createResource = mock(async (req: CreateResourceArgs) =>
      readyRow({ id: req.id, status: "pending", repositoryKey: req.repositoryKey })
    );
    const updateResource = mock(async (_req: unknown) => readyRow());
    const barkloaderRequest = grantingBarkloader();
    const api = host({ db: { createResource, updateResource }, barkloaderRequest });

    const grant = await api.requestUploadUrl({ name: "clip.png", contentType: "image/png", size: 2048 });

    const [path, init] = barkloaderRequest.mock.calls[0];
    expect(path).toBe("/assets/upload-url");
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown> & { resource_id: string };
    expect(sent).toMatchObject({
      file_name: "clip.png",
      content_type: "image/png",
      content_length: 2048,
      area: "media",
    });
    expect(Object.keys(sent).sort()).toEqual(["area", "content_length", "content_type", "file_name", "resource_id"]);
    expect(sent.resource_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // db-proxy refuses a file row without its key, so the row must be
    // created with the id barkloader keyed on and the key it issued.
    expect(createResource).toHaveBeenCalledTimes(1);
    expect(createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sent.resource_id,
        repositoryKey: `user/${sent.resource_id}/clip.png`,
        status: "pending",
        kind: "image",
        contentType: "image/png",
        size: BigInt(2048),
      })
    );
    expect(updateResource).not.toHaveBeenCalled();

    expect(grant.resource.id).toBe(sent.resource_id);
    expect(grant.resource.status).toBe("pending");
    expect(grant.resource.url).toBeNull();
    expect(grant.uploadUrl).toBe("http://storage.test/put");
    expect(grant.expiresAt).toBe(1_700_000_300);
  });

  test("every upload gets its own id", async () => {
    const createResource = mock(async (req: CreateResourceArgs) =>
      readyRow({ id: req.id, repositoryKey: req.repositoryKey })
    );
    const api = host({ db: { createResource }, barkloaderRequest: grantingBarkloader() });

    await api.requestUploadUrl({ name: "a.png", contentType: "image/png", size: 1024 });
    await api.requestUploadUrl({ name: "b.png", contentType: "image/png", size: 1024 });

    const ids = createResource.mock.calls.map((call) => call[0].id);
    expect(new Set(ids).size).toBe(2);
  });

  test("classifies kind from the content type", async () => {
    const createResource = mock(async (req: CreateResourceArgs) =>
      readyRow({ status: "pending", repositoryKey: req.repositoryKey })
    );
    const api = host({ db: { createResource }, barkloaderRequest: grantingBarkloader() });

    await api.requestUploadUrl({ name: "a.mp4", contentType: "video/mp4", size: 1024 });
    await api.requestUploadUrl({ name: "b.mp3", contentType: "audio/mpeg", size: 1024 });
    await api.requestUploadUrl({ name: "c.bin", contentType: "application/octet-stream", size: 1024 });

    const kinds = createResource.mock.calls.map((call) => call[0].kind);
    expect(kinds).toEqual(["video", "audio", "other"]);
  });

  test("a declared module archive is kind custom_module, stored in the archive directory", async () => {
    const createResource = mock(async (req: CreateResourceArgs) =>
      readyRow({ id: req.id, status: "pending", kind: req.kind, repositoryKey: req.repositoryKey })
    );
    const barkloaderRequest = grantingBarkloader();
    const api = host({ db: { createResource }, barkloaderRequest });

    const grant = await api.requestUploadUrl({
      name: "shoutout.zip",
      contentType: "application/zip",
      size: 4096,
      kind: "custom_module",
    });

    const sent = JSON.parse(String(barkloaderRequest.mock.calls[0]?.[1]?.body)) as {
      resource_id: string;
      area: string;
    };
    expect(sent.area).toBe("custom_module");
    expect(createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "custom_module",
        repositoryKey: `user/custom-modules/${sent.resource_id}/shoutout.zip`,
      })
    );
    expect(grant.resource.kind).toBe("custom_module");
    expect(grant.resource.url).toBeNull();
  });

  test("a zip not declared a module archive stays an ordinary upload", async () => {
    const createResource = mock(async (req: CreateResourceArgs) => readyRow({ repositoryKey: req.repositoryKey }));
    const api = host({ db: { createResource }, barkloaderRequest: grantingBarkloader() });

    await api.requestUploadUrl({ name: "pack.zip", contentType: "application/zip", size: 1024 });

    expect(createResource.mock.calls[0]?.[0].kind).toBe("other");
  });

  test("refuses a module archive that is not a zip, or that names a folder", async () => {
    const createResource = mock(async (_req: unknown) => readyRow());
    const barkloaderRequest = grantingBarkloader();
    const api = host({ db: { createResource }, barkloaderRequest });

    await expect(
      api.requestUploadUrl({ name: "m.tar", contentType: "application/x-tar", size: 1024, kind: "custom_module" })
    ).rejects.toThrow("A module archive must be uploaded as application/zip");
    await expect(
      api.requestUploadUrl({
        name: "m.zip",
        contentType: "application/zip",
        size: 1024,
        kind: "custom_module",
        parentId: "folder-1",
      })
    ).rejects.toThrow("A module archive is stored at the root");
    await expect(
      api.requestUploadUrl({ name: "a.png", contentType: "image/png", size: 1024, kind: "image" as never })
    ).rejects.toThrow('kind may only be "custom_module"');
    expect(barkloaderRequest).not.toHaveBeenCalled();
    expect(createResource).not.toHaveBeenCalled();
  });

  test("refuses a module archive grant keyed outside the archive directory", async () => {
    const createResource = mock(async (_req: unknown) => readyRow());
    const barkloaderRequest = mock(async (_path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { resource_id: string };
      return new Response(
        JSON.stringify({
          repositoryKey: `user/${body.resource_id}/m.zip`,
          uploadUrl: "u",
          method: "PUT",
          headers: [],
          expiresAt: 0,
        })
      );
    });
    const api = host({ db: { createResource }, barkloaderRequest });

    await expect(
      api.requestUploadUrl({ name: "m.zip", contentType: "application/zip", size: 1024, kind: "custom_module" })
    ).rejects.toThrow("Upload grant repository key is not under user/custom-modules/");
    expect(createResource).not.toHaveBeenCalled();
  });

  test("refuses a grant whose key is not under the minted resource id", async () => {
    const createResource = mock(async (_req: unknown) => readyRow());
    const api = host({
      db: { createResource },
      barkloaderRequest: mock(
        async () =>
          new Response(
            JSON.stringify({
              repositoryKey: "user/other/clip.png",
              uploadUrl: "u",
              method: "PUT",
              headers: [],
              expiresAt: 0,
            })
          )
      ),
    });

    await expect(api.requestUploadUrl({ name: "clip.png", contentType: "image/png", size: 1024 })).rejects.toThrow(
      "Upload grant repository key is not under"
    );
    expect(createResource).not.toHaveBeenCalled();
  });

  test("rejects a size that no body can have before asking for a grant", async () => {
    const createResource = mock(async (_req: unknown) => readyRow());
    const barkloaderRequest = grantingBarkloader();
    const api = host({ db: { createResource }, barkloaderRequest });

    for (const size of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
      await expect(api.requestUploadUrl({ name: "clip.png", contentType: "image/png", size })).rejects.toThrow(
        "size must be a whole number of bytes"
      );
    }
    expect(barkloaderRequest).not.toHaveBeenCalled();
    expect(createResource).not.toHaveBeenCalled();
  });

  test("rejects a nameless upload before asking for a grant", async () => {
    const createResource = mock(async (_req: unknown) => readyRow());
    const barkloaderRequest = grantingBarkloader();
    const api = host({ db: { createResource }, barkloaderRequest });

    await expect(api.requestUploadUrl({ name: "", contentType: "image/png", size: 1024 })).rejects.toThrow(
      "name is required"
    );
    expect(barkloaderRequest).not.toHaveBeenCalled();
    expect(createResource).not.toHaveBeenCalled();
  });
});

describe("folders", () => {
  test("createFolder passes the parent through", async () => {
    const createResourceFolder = mock(async (_req: any) =>
      readyRow({ isFolder: true, kind: "folder", name: "clips", repositoryKey: "" })
    );
    const api = host({ db: { createResourceFolder } });

    const folder = await api.createFolder("clips", "parent-1");

    expect(createResourceFolder).toHaveBeenCalledWith(expect.objectContaining({ name: "clips", parentId: "parent-1" }));
    expect(folder.isFolder).toBe(true);
  });

  test("moving to the root sends an empty parent rather than omitting it", async () => {
    const updateResource = mock(async (_req: any) => readyRow());
    const api = host({ db: { updateResource } });

    await api.updateResource("res-1", { parentId: null });

    // Absent means "leave alone"; present-but-empty means "move to root".
    expect(updateResource).toHaveBeenCalledWith(expect.objectContaining({ id: "res-1", parentId: "" }));
  });

  test("a module archive cannot be moved into a folder", async () => {
    const updateResource = mock(async (_req: any) => readyRow());
    const getResource = mock(async (_req: any) => readyRow({ kind: "custom_module" }));
    const api = host({ db: { updateResource, getResource } });

    await expect(api.updateResource("res-1", { parentId: "folder-1" })).rejects.toThrow(
      "A module archive is stored at the root"
    );
    expect(updateResource).not.toHaveBeenCalled();
  });

  test("a rename leaves the parent untouched", async () => {
    const updateResource = mock(async (_req: any) => readyRow());
    const api = host({ db: { updateResource } });

    await api.updateResource("res-1", { name: "renamed.png" });

    const request = updateResource.mock.calls[0]?.[0] as { name?: string; parentId?: string };
    expect(request.name).toBe("renamed.png");
    expect(request.parentId).toBeUndefined();
  });
});

describe("deleteResource", () => {
  test("passes on db-proxy's refusal to delete an archive an installed module came from, purging nothing", async () => {
    const deleteResource = mock(async (_req: any) => {
      throw new Error(
        '"shoutout.zip" is the archive module "Shoutout" was installed from; uninstall the module before deleting it'
      );
    });
    const barkloaderRequest = mock(async (_path: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    const api = host({ db: { deleteResource }, barkloaderRequest });

    await expect(api.deleteResource("res-1")).rejects.toThrow("uninstall the module before deleting it");
    expect(barkloaderRequest).not.toHaveBeenCalled();
  });

  test("purges each resource directory once, by a key db-proxy reports", async () => {
    const deleteResource = mock(async (_req: any) => [
      "user/res-1/clip.png",
      "user/res-1/thumbnail.png",
      "user/res-2/other.png",
    ]);
    const barkloaderRequest = mock(async (_path: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    const api = host({ db: { deleteResource }, barkloaderRequest });

    await api.deleteResource("res-1");

    // Two distinct resource directories, not three keys: the thumbnail
    // shares a directory with the upload it was derived from.
    expect(barkloaderRequest).toHaveBeenCalledTimes(2);
    const calls = barkloaderRequest.mock.calls.map(([path, init]) => ({
      path,
      method: init?.method,
      body: JSON.parse(String(init?.body)) as { repositoryKey: string },
    }));
    expect(calls.map((c) => c.path)).toEqual(["/assets/resource", "/assets/resource"]);
    expect(calls.map((c) => c.method)).toEqual(["DELETE", "DELETE"]);
    expect(calls.map((c) => c.body.repositoryKey)).toEqual(["user/res-1/thumbnail.png", "user/res-2/other.png"]);
  });

  test("sends a key in an older layout verbatim rather than rebuilding it from ids", async () => {
    const legacyKey = "user/0b6f7c1e-2d0a-4c3b-9f7e-1a2b3c4d5e6f/res-1/clip.png";
    const barkloaderRequest = mock(async (_path: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    const api = host({ db: { deleteResource: mock(async (_req: unknown) => [legacyKey]) }, barkloaderRequest });

    await api.deleteResource("res-1");

    const [, init] = barkloaderRequest.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ repositoryKey: legacyKey });
  });

  test("a storage purge failure does not fail the delete", async () => {
    const api = host({
      db: {
        deleteResource: mock(async (_req: any) => ["user/res-1/clip.png"]),
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
      db: { getResource: mock(async (_req: any) => readyRow()) },
      barkloaderRequest,
    });

    await api.requestProcessing("res-1");

    const [path, init] = barkloaderRequest.mock.calls[0];
    expect(path).toBe("/assets/process");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      repository_key: "user/res-1/clip.png",
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
        getResource: mock(async (_req: any) => readyRow({ repositoryKey: "" })),
      },
    });
    await expect(api.requestProcessing("res-1")).rejects.toThrow("no stored object");
  });

  test("requestPosterUploadUrl asks barkloader for a grant keyed on the video's stored key", async () => {
    const grant = {
      repositoryKey: "user/res-1/.poster",
      uploadUrl: "http://127.0.0.1:9101/assets/upload/token",
      method: "PUT",
      headers: [{ name: "Content-Type", value: "image/png" }],
      expiresAt: 1_700_000_300,
    };
    const barkloaderRequest = mock(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify(grant)));
    const api = host({
      db: {
        getResource: mock(async (_req: any) =>
          readyRow({ name: "clip.mp4", kind: "video", contentType: "video/mp4", repositoryKey: "user/res-1/clip.mp4" })
        ),
      },
      barkloaderRequest,
    });

    const result = await api.requestPosterUploadUrl("res-1", "image/png", 4096);

    const [path, init] = barkloaderRequest.mock.calls[0];
    expect(path).toBe("/assets/poster-upload-url");
    expect(JSON.parse(String(init?.body))).toEqual({
      repository_key: "user/res-1/clip.mp4",
      content_type: "image/png",
      content_length: 4096,
    });
    expect(result).toEqual({
      uploadUrl: grant.uploadUrl,
      method: "PUT",
      headers: grant.headers,
      expiresAt: grant.expiresAt,
    });
  });

  test("a poster is refused for a resource that is not a video", async () => {
    const barkloaderRequest = mock(async (_path: string, _init?: RequestInit) => new Response("{}"));
    const api = host({ db: { getResource: mock(async (_req: any) => readyRow()) }, barkloaderRequest });

    await expect(api.requestPosterUploadUrl("res-1", "image/png", 4096)).rejects.toThrow("Only video resources");
    expect(barkloaderRequest).not.toHaveBeenCalled();
  });

  test("a poster that is not an image is refused before the row is read", async () => {
    const getResource = mock(async (_req: any) => readyRow({ kind: "video" }));
    const api = host({ db: { getResource } });

    await expect(api.requestPosterUploadUrl("res-1", "video/mp4", 4096)).rejects.toThrow("must be an image");
    expect(getResource).not.toHaveBeenCalled();
  });

  test("a poster of a size no body can have is refused before the row is read", async () => {
    const getResource = mock(async (_req: any) => readyRow({ kind: "video" }));
    const api = host({ db: { getResource } });

    await expect(api.requestPosterUploadUrl("res-1", "image/png", 0)).rejects.toThrow(
      "size must be a whole number of bytes"
    );
    expect(getResource).not.toHaveBeenCalled();
  });

  test("getResourceUsage reports db-proxy's totals as numbers", async () => {
    const api = host({ db: { getResourceUsage: mock(async () => ({ bytes: 5_000_000n, files: 3n })) } });

    expect(await api.getResourceUsage()).toEqual({ bytes: 5_000_000, files: 3 });
  });

  test("a completed job records the thumbnail key", async () => {
    const updateResource = mock(async (_req: any) => readyRow());
    const api = host({ db: { updateResource } });

    await api.handleProcessingCallback({
      resource_id: "res-1",
      repository_key: "user/res-1/clip.png",
      utility: "thumbnail",
      status: "completed",
      thumbnail_repository_key: "user/res-1/thumbnail.png",
    });

    expect(updateResource).toHaveBeenCalledWith(
      expect.objectContaining({ id: "res-1", thumbnailRepositoryKey: "user/res-1/thumbnail.png" })
    );
  });

  test("not_applicable is a success that writes nothing", async () => {
    const updateResource = mock(async (_req: any) => readyRow());
    const api = host({ db: { updateResource } });

    // Audio has no frame to render. Recording a failure here would put a
    // retry loop behind something that can never succeed.
    await api.handleProcessingCallback({
      resource_id: "res-1",
      repository_key: "user/res-1/song.mp3",
      utility: "thumbnail",
      status: "not_applicable",
      reason: "audio has no renderable frame",
    });

    expect(updateResource).not.toHaveBeenCalled();
  });

  test("a failed job leaves the row untouched", async () => {
    const updateResource = mock(async (_req: any) => readyRow());
    const api = host({ db: { updateResource } });

    await api.handleProcessingCallback({
      resource_id: "res-1",
      utility: "thumbnail",
      status: "failed",
      error: "decoding source image",
    });

    expect(updateResource).not.toHaveBeenCalled();
  });

  test("a callback with no resource id is dropped rather than throwing", async () => {
    const updateResource = mock(async (_req: any) => readyRow());
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
      sceneManagerUrl: BASE_URL,
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
