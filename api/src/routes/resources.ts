import { routeModule } from "./context";
import type * as resource from "@woofx3/db/resource.pb";
import { resolveSceneManagerUrl, timestampToIso } from "./helpers";

/**
 * Wire shape for a stored user asset.
 *
 * `url` and `thumbnailUrl` are derived, never stored: the database keeps
 * repository keys, and the public URL those map to depends on where the
 * overlay gateway is reachable, which is deployment state rather than
 * row state.
 */
export interface ResourceItem {
  id: string;
  name: string;
  parentId: string | null;
  isFolder: boolean;
  kind: string;
  contentType: string;
  size: number;
  status: string;
  url: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadGrant {
  resource: ResourceItem;
  uploadUrl: string;
  method: string;
  headers: Array<{ name: string; value: string }>;
  /** Unix seconds, absolute so the caller need not reason about skew. */
  expiresAt: number;
}

/** Completion payload barkloader POSTs back once processing finishes. */
interface ProcessingCallbackBody {
  resource_id?: string;
  repository_key?: string;
  utility?: string;
  status?: string;
  thumbnail_repository_key?: string;
  content_type?: string;
  reason?: string;
  error?: string;
}

const UTILITY_THUMBNAIL = "thumbnail";

/**
 * Map a MIME type onto the coarse `kind` the UI groups and filters by.
 * Stored at create time so listing never has to re-parse MIME types.
 */
function kindForContentType(contentType: string): string {
  const type = contentType.toLowerCase();
  if (type.startsWith("image/")) {
    return "image";
  }
  if (type.startsWith("video/")) {
    return "video";
  }
  if (type.startsWith("audio/")) {
    return "audio";
  }
  return "other";
}

/**
 * Deliberately a module-private function rather than a member of
 * `resourcesRoutes`: everything on that object is registered onto the
 * Api prototype, which both exposes it as a callable RPC method and runs
 * it through the span wrapper -- and that wrapper returns a Promise,
 * which would turn this string into a Promise.
 */
export function resourcePublicUrl(sceneManagerUrl: string, repositoryKey: string): string | null {
  if (repositoryKey.length === 0) {
    return null;
  }
  const base = sceneManagerUrl.replace(/\/+$/, "");
  return `${base}/assets/${repositoryKey}`;
}

/** Map a stored row onto its wire shape. Module-private, for the same reason. */
export function resourceToItem(sceneManagerUrl: string, row: resource.Resource): ResourceItem {
  const repositoryKey = row.repositoryKey ?? "";
  const thumbnailKey = row.thumbnailRepositoryKey ?? "";
  const isFolder = row.isFolder ?? false;
  // A pending row has no bytes at its key yet, so publishing a URL for
  // it would hand out a link that 404s until the upload lands.
  const servable = !isFolder && row.status === "ready";
  return {
    id: row.id ?? "",
    name: row.name ?? "",
    parentId: row.parentId && row.parentId.length > 0 ? row.parentId : null,
    isFolder,
    kind: row.kind ?? "other",
    contentType: row.contentType ?? "",
    size: Number(row.size ?? 0),
    status: row.status ?? "",
    url: servable ? resourcePublicUrl(sceneManagerUrl, repositoryKey) : null,
    thumbnailUrl: servable ? resourcePublicUrl(sceneManagerUrl, thumbnailKey) : null,
    createdAt: timestampToIso(row.createdAt),
    updatedAt: timestampToIso(row.updatedAt),
  };
}

export const resourcesRoutes = routeModule({
  /**
   * Hand back a grant to upload straight to storage, and reserve the row
   * the upload will belong to.
   *
   * The resource id is minted here rather than by db-proxy because the
   * repository key embeds it -- that is what keeps one resource's objects
   * (the upload and any derived thumbnail) together under one prefix --
   * and db-proxy refuses a file row without its key. So the grant comes
   * first and the row is created already holding the real key. A grant
   * whose row then fails to create (a sibling name clash, say) is
   * harmless: nothing was written under it and it expires on its own.
   *
   * The row starts "pending": it exists, but nothing is servable from it
   * until the caller reports the bytes landed.
   */
  async requestUploadUrl(input: {
    name: string;
    contentType: string;
    parentId?: string | null;
    size?: number;
    ttlSeconds?: number;
  }): Promise<UploadGrant> {
    if (input.name.length === 0) {
      throw new Error("name is required");
    }
    if (input.contentType.length === 0) {
      throw new Error("contentType is required");
    }

    const resourceId = crypto.randomUUID();
    const response = await this.barkloaderRequest("/assets/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resource_id: resourceId,
        file_name: input.name,
        content_type: input.contentType,
        ttl_seconds: input.ttlSeconds,
      }),
    });
    const grant = (await response.json()) as {
      repositoryKey: string;
      uploadUrl: string;
      method: string;
      headers: Array<{ name: string; value: string }>;
      expiresAt: number;
    };

    // deleteResource purges storage by the directory holding the stored key,
    // so a key outside this resource's own directory would take other
    // resources' bytes with it on delete.
    const expectedPrefix = `user/${resourceId}/`;
    if (typeof grant.repositoryKey !== "string" || !grant.repositoryKey.startsWith(expectedPrefix)) {
      throw new Error(`Upload grant repository key is not under ${expectedPrefix}: ${String(grant.repositoryKey)}`);
    }

    const row = await this.db.createResource({
      id: resourceId,
      parentId: input.parentId ?? undefined,
      name: input.name,
      kind: kindForContentType(input.contentType),
      contentType: input.contentType,
      repositoryKey: grant.repositoryKey,
      size: BigInt(input.size ?? 0),
      status: "pending",
    });

    this.logger.info("Issued upload grant", { resourceId, name: input.name });
    return {
      resource: resourceToItem(await resolveSceneManagerUrl(this.db, this.sceneManagerUrl), row),
      uploadUrl: grant.uploadUrl,
      method: grant.method,
      headers: grant.headers,
      expiresAt: grant.expiresAt,
    };
  },

  /**
   * Promote a resource to "ready" once its bytes are in place. Until this
   * is called the row is inert: it lists, but serves no URL.
   */
  async completeUpload(resourceId: string, size?: number): Promise<ResourceItem> {
    const response = await this.db.updateResource({
      id: resourceId,
      status: "ready",
      size: size === undefined ? undefined : BigInt(size),
    } as resource.UpdateResourceRequest);
    return resourceToItem(await resolveSceneManagerUrl(this.db, this.sceneManagerUrl), response);
  },

  async createFolder(name: string, parentId?: string | null): Promise<ResourceItem> {
    if (name.length === 0) {
      throw new Error("name is required");
    }
    const response = await this.db.createResourceFolder({
      parentId: parentId ?? undefined,
      name,
    });
    return resourceToItem(await resolveSceneManagerUrl(this.db, this.sceneManagerUrl), response);
  },

  async getResource(id: string): Promise<ResourceItem> {
    const response = await this.db.getResource({ id });
    return resourceToItem(await resolveSceneManagerUrl(this.db, this.sceneManagerUrl), response);
  },

  /**
   * List one folder's direct children, or the root when no folder is
   * given. Thumbnails never appear here: a thumbnail is a column on the
   * row it belongs to, not a row of its own, so there is nothing to
   * filter out.
   */
  async listResources(query?: {
    folderId?: string | null;
    kind?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ resources: ResourceItem[]; total: number; page: number; pageSize: number }> {
    const response = await this.db.listResources({
      parentId: query?.folderId ?? undefined,
      kind: query?.kind ?? "",
      search: query?.search ?? "",
      page: query?.page ?? 0,
      pageSize: query?.pageSize ?? 0,
    });
    const sceneManagerUrl = await resolveSceneManagerUrl(this.db, this.sceneManagerUrl);
    return {
      resources: response.resources.map((row) => resourceToItem(sceneManagerUrl, row)),
      total: response.total,
      page: response.page,
      pageSize: response.pageSize,
    };
  },

  /** Rename, or move by supplying a new parent. Null moves to the root. */
  async updateResource(id: string, changes: { name?: string; parentId?: string | null }): Promise<ResourceItem> {
    const request: resource.UpdateResourceRequest = {
      id,
      name: changes.name,
      // Present-but-empty is how the proto expresses "move to root", so a
      // null here must still be sent rather than dropped as absent.
      parentId: changes.parentId === undefined ? undefined : (changes.parentId ?? ""),
    } as resource.UpdateResourceRequest;
    const response = await this.db.updateResource(request);
    return resourceToItem(await resolveSceneManagerUrl(this.db, this.sceneManagerUrl), response);
  },

  /**
   * Delete a resource (or a folder and its subtree) and purge the stored
   * objects behind it.
   *
   * db-proxy returns the repository keys of everything it removed, since
   * only it can walk the subtree. Storage is purged per resource
   * directory rather than per key so an upload and its thumbnail always
   * go together. A storage failure is logged rather than thrown: the rows
   * are already gone, so raising here would report a failure for work
   * that mostly succeeded and invite a retry that cannot fix anything.
   */
  async deleteResource(id: string): Promise<{ deleted: boolean }> {
    const repositoryKeys = await this.db.deleteResource({ id });

    // One representative key per directory: barkloader removes the whole
    // directory holding the key it is given. The stored key is used verbatim
    // because rows written under an older layout keep their original path.
    const keysByDirectory = new Map<string, string>();
    for (const key of repositoryKeys) {
      const slash = key.lastIndexOf("/");
      if (slash <= 0) {
        this.logger.error("Deleted resource has a repository key with no directory; skipping purge", { key });
        continue;
      }
      keysByDirectory.set(key.slice(0, slash), key);
    }

    for (const repositoryKey of keysByDirectory.values()) {
      try {
        await this.barkloaderRequest("/assets/resource", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repositoryKey }),
        });
      } catch (err) {
        this.logger.error("Failed to purge stored objects for deleted resource", {
          repositoryKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { deleted: true };
  },

  /**
   * Ask barkloader to derive something from an already-uploaded resource.
   *
   * Returns as soon as the work is accepted. Completion arrives later on
   * the callback below, which is why the resource id is handed over: it
   * is echoed back so the completion can be matched to the row waiting
   * for it.
   */
  async requestProcessing(resourceId: string, utility: string = UTILITY_THUMBNAIL): Promise<{ accepted: boolean }> {
    if (utility !== UTILITY_THUMBNAIL) {
      throw new Error(`Unsupported processing utility: ${utility}`);
    }

    const existing = await this.db.getResource({ id: resourceId });
    const row = existing;
    if (row.isFolder === true) {
      throw new Error("Folders cannot be processed");
    }
    const repositoryKey = row.repositoryKey ?? "";
    if (repositoryKey.length === 0) {
      throw new Error("Resource has no stored object to process");
    }

    const base = this.apiUrl.replace(/\/+$/, "");
    await this.barkloaderRequest("/assets/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repository_key: repositoryKey,
        content_type: row.contentType ?? "",
        utility,
        callback_url: `${base}/webhooks/barkloader/processing`,
        resource_id: resourceId,
      }),
    });

    this.logger.info("Requested resource processing", { resourceId, utility });
    return { accepted: true };
  },

  /**
   * Record the outcome of an async processing job.
   *
   * "not_applicable" is a success, not a failure: audio has no frame to
   * render. It is recorded by leaving the thumbnail key empty and
   * returning normally, so nothing upstream retries work that can never
   * succeed.
   */
  async handleProcessingCallback(body: ProcessingCallbackBody): Promise<void> {
    const resourceId = body.resource_id ?? "";
    if (resourceId.length === 0) {
      this.logger.error("Processing callback carried no resource id", { body });
      return;
    }

    if (body.status === "failed") {
      this.logger.error("Resource processing failed", {
        resourceId,
        utility: body.utility,
        error: body.error,
      });
      return;
    }

    const thumbnailKey = body.thumbnail_repository_key ?? "";
    if (thumbnailKey.length === 0) {
      this.logger.info("Resource processing not applicable", {
        resourceId,
        utility: body.utility,
        reason: body.reason,
      });
      return;
    }

    await this.db.updateResource({
      id: resourceId,
      thumbnailRepositoryKey: thumbnailKey,
    } as resource.UpdateResourceRequest);
    this.logger.info("Recorded generated thumbnail", { resourceId });
  },
});
