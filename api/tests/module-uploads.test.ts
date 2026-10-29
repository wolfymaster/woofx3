import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { moduleUploadsRoutes, uploadedModuleKey } from "../src/routes/module-uploads";

const RESOURCE_ID = "00000000-0000-0000-0000-0000000000a1";
const ARCHIVE_KEY = `user/custom-modules/${RESOURCE_ID}/shoutout.zip`;

function moduleZip(manifest: Record<string, unknown>): Uint8Array {
  return zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)) });
}

const MANIFEST = {
  id: "shoutout",
  name: "Shoutout",
  version: "1.2.0",
  permissions: ["chat.send"],
  local: [{ id: "obs", name: "OBS", protocol: "ws" }],
};
const APPROVED = { approvedPermissions: ["chat.send"], approvedLocalEndpoints: ["obs"] };

function resourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RESOURCE_ID,
    name: "shoutout.zip",
    kind: "custom_module",
    contentType: "application/zip",
    repositoryKey: ARCHIVE_KEY,
    status: "ready",
    ...overrides,
  };
}

/** Stands in for the api host: db-proxy, barkloader and the webhook client. */
function host(options: { row?: Record<string, unknown> | null; archive?: Uint8Array; installed?: unknown } = {}) {
  const archive = options.archive ?? moduleZip(MANIFEST);
  const sent: Array<Record<string, unknown>> = [];
  const forms: FormData[] = [];
  const barkloaderRequest = mock(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/assets/custom-module?")) {
      return new Response(archive as Uint8Array<ArrayBuffer>);
    }
    if (path === "/functions") {
      forms.push(init?.body as FormData);
      return Response.json({ message: "accepted" });
    }
    throw new Error(`unexpected barkloader request ${path}`);
  });
  const stub = {
    logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    barkloaderRequest,
    webhookClient: {
      send: async (event: Record<string, unknown>) => {
        sent.push(event);
      },
    },
    db: {
      getResource: mock(async (_req: { id: string }) => {
        if (options.row === null) {
          throw new Error("resource not found");
        }
        return resourceRow(options.row);
      }),
      getModuleByModuleKey: mock(async (_key: string) => options.installed ?? null),
    },
  };
  const install = moduleUploadsRoutes.installModuleFromResource as unknown as (
    resourceId: string,
    request: unknown,
    context: { clientId: string }
  ) => Promise<{ moduleKey: string }>;
  return {
    archive,
    sent,
    forms,
    barkloaderRequest,
    install: (request: unknown = APPROVED, resourceId = RESOURCE_ID) =>
      install.call(stub, resourceId, request, { clientId: "client-1" }),
  };
}

function expectedKey(archive: Uint8Array): string {
  return `shoutout:1.2.0:${createHash("sha256").update(archive).digest("hex").slice(0, 7)}`;
}

describe("uploadedModuleKey", () => {
  test("is the manifest id and version and the archive's short sha256, as barkloader computes it", () => {
    const archive = moduleZip(MANIFEST);
    expect(uploadedModuleKey(MANIFEST, archive)).toBe(expectedKey(archive));
  });

  test("refuses a manifest without an id or a version", () => {
    const archive = moduleZip(MANIFEST);
    expect(() => uploadedModuleKey({ version: "1.0.0" }, archive)).toThrow("has no id");
    expect(() => uploadedModuleKey({ id: "x", version: 3 }, archive)).toThrow("has no version");
  });
});

describe("installModuleFromResource", () => {
  test("reads the stored archive and hands it to barkloader with its key and origin", async () => {
    const api = host();

    const result = await api.install();

    expect(result.moduleKey).toBe(expectedKey(api.archive));
    const [readPath] = api.barkloaderRequest.mock.calls[0] ?? [];
    expect(readPath).toBe(`/assets/custom-module?repositoryKey=${encodeURIComponent(ARCHIVE_KEY)}`);
    expect(api.forms).toHaveLength(1);
    const form = api.forms[0] as FormData;
    expect(form.get("module_key")).toBe(result.moduleKey);
    expect(form.get("client_id")).toBe("client-1");
    expect(form.get("upload_resource_id")).toBe(RESOURCE_ID);
    expect(form.get("marketplace_listing_id")).toBeNull();
    const file = form.get("file") as File;
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual(Array.from(api.archive));
  });

  test("answers an already installed key without reinstalling", async () => {
    const api = host({ installed: { moduleId: "shoutout", name: "Shoutout", version: "1.2.0" } });

    const result = await api.install();

    expect(api.forms).toHaveLength(0);
    expect(api.sent).toEqual([
      expect.objectContaining({
        type: "module.installed",
        moduleKey: result.moduleKey,
        alreadyInstalled: true,
        source: "upload",
        uploadResourceId: RESOURCE_ID,
      }),
    ]);
  });

  test("refuses an unknown resource, another kind, or an upload that has not completed", async () => {
    await expect(host({ row: null }).install()).rejects.toThrow("resource not found");
    await expect(host({ row: { kind: "other" } }).install()).rejects.toThrow("is not a custom module archive");
    await expect(host({ row: { status: "pending" } }).install()).rejects.toThrow("has not finished uploading");
  });

  test("refuses an archive declaring a permission or local endpoint that was not approved", async () => {
    const permission = host();
    await expect(permission.install({ approvedPermissions: [], approvedLocalEndpoints: ["obs"] })).rejects.toThrow(
      "declares what was not approved: chat.send"
    );
    expect(permission.forms).toHaveLength(0);

    const endpoint = host();
    await expect(endpoint.install({ approvedPermissions: ["chat.send"], approvedLocalEndpoints: [] })).rejects.toThrow(
      "declares what was not approved: local:obs"
    );
    expect(endpoint.forms).toHaveLength(0);
  });

  test("refuses approvals that are not lists of strings", async () => {
    await expect(host().install({ approvedPermissions: "chat.send", approvedLocalEndpoints: [] })).rejects.toThrow(
      "approvedPermissions must be an array of strings"
    );
  });
});
