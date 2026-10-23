import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dbProxyClientConfig } from "@woofx3/db/service-auth";
import { WorkflowExecutionResponse, WorkflowResponse } from "@woofx3/db/workflow.pb";
import { DbClient, DbError } from "../src/db-client";

function twirpError(status: number, code: string): () => Response {
  return () =>
    new Response(JSON.stringify({ code, msg: code }), {
      status,
      headers: { "content-type": "application/json" },
    });
}

function protobuf(encoded: Uint8Array): () => Response {
  return () =>
    new Response(new Uint8Array(encoded), {
      status: 200,
      headers: { "content-type": "application/protobuf" },
    });
}

const found = {
  findWorkflow: protobuf(
    WorkflowResponse.encode({ status: { code: "OK", message: "" }, workflow: { id: "wf-1", name: "Raid" } })
  ),
  findWorkflowExecution: protobuf(
    WorkflowExecutionResponse.encode({
      status: { code: "OK", message: "" },
      execution: { id: "run-1", workflowId: "wf-1", status: "completed" },
    })
  ),
};

type Lookup = keyof typeof found;

function lookup(client: DbClient, name: Lookup) {
  return name === "findWorkflow" ? client.findWorkflow({ id: "x" }) : client.findWorkflowExecution({ id: "x" });
}

describe.each(Object.keys(found) as Lookup[])("DbClient.%s", (name) => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function respondWith(response: () => Response) {
    globalThis.fetch = (async () => response()) as unknown as typeof globalThis.fetch;
  }

  test("returns the row db-proxy holds", async () => {
    respondWith(found[name]);

    expect((await lookup(new DbClient(dbProxyClientConfig("http://db.test", "test-token")), name))?.id).toBe(
      name === "findWorkflow" ? "wf-1" : "run-1"
    );
  });

  const missing: Array<[string, () => Response]> = [
    ["db-proxy has no such row", twirpError(404, "not_found")],
    ["the id is not one db-proxy can parse", twirpError(400, "invalid_argument")],
  ];
  for (const [why, response] of missing) {
    test(`returns null when ${why}`, async () => {
      respondWith(response);

      expect(await lookup(new DbClient(dbProxyClientConfig("http://db.test", "test-token")), name)).toBeNull();
    });
  }

  test("fails on an envelope that is not OK", async () => {
    const failed = { status: { code: "INTERNAL" as const, message: "db down" } };
    respondWith(
      protobuf(name === "findWorkflow" ? WorkflowResponse.encode(failed) : WorkflowExecutionResponse.encode(failed))
    );

    await expect(
      lookup(new DbClient(dbProxyClientConfig("http://db.test", "test-token")), name)
    ).rejects.toBeInstanceOf(DbError);
  });

  test("still fails on any other error", async () => {
    respondWith(twirpError(500, "internal"));

    await expect(
      lookup(new DbClient(dbProxyClientConfig("http://db.test", "test-token")), name)
    ).rejects.toBeInstanceOf(DbError);
  });
});
