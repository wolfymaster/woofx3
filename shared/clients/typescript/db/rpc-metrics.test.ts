import { describe, expect, test } from "bun:test";
import { MetricsHarness } from "@woofx3/common/logging/metrics-testing";
import type { RpcTransport } from "twirpscript";
import { instrumentTransport } from "./rpc-metrics";

type RpcTransportResponse = Awaited<ReturnType<RpcTransport>>;

const URL_OF = "http://db-proxy:8080/twirp/woofx3.db.Command/GetCommand";

function reply(status: number, body: string): RpcTransportResponse {
  return {
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
    headers: { get: () => null },
    json: async () => JSON.parse(body),
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

/** A clock that reads 0 and then 0.25 s later, so a call lasts exactly 250 ms. */
function quarterSecondClock(): () => number {
  let reads = 0;
  return () => (reads++ % 2) * 250;
}

async function recorded(harness: MetricsHarness) {
  const metric = await harness.metric("rpc.client.duration");
  return { unit: metric.unit, points: metric.points.map((p) => ({ attributes: p.attributes, value: p.value })) };
}

describe("instrumentTransport", () => {
  test("test_a_successful_call_records_seconds_with_the_twirp_service_and_method", async () => {
    const harness = new MetricsHarness();
    const transport = instrumentTransport(harness.meter, async () => reply(200, "{}"), quarterSecondClock());

    await transport(URL_OF, { method: "POST", headers: {}, body: "{}" });

    const { unit, points } = await recorded(harness);
    expect(unit).toBe("s");
    expect(points).toHaveLength(1);
    expect(points[0]?.attributes).toEqual({
      "rpc.system": "twirp",
      "rpc.service": "woofx3.db.Command",
      "rpc.method": "GetCommand",
    });
    expect(points[0]?.value).toMatchObject({ count: 1, sum: 0.25 });
  });

  test("test_a_twirp_error_records_its_code_and_leaves_the_body_readable", async () => {
    const harness = new MetricsHarness();
    const body = JSON.stringify({ code: "not_found", msg: "no such command" });
    const transport = instrumentTransport(harness.meter, async () => reply(404, body));

    const response = await transport(URL_OF, { method: "POST", headers: {}, body: "{}" });

    expect((await recorded(harness)).points[0]?.attributes).toMatchObject({ "error.type": "not_found" });
    expect(await response.json()).toEqual({ code: "not_found", msg: "no such command" });
  });

  test("test_a_non_twirp_error_page_records_the_http_status", async () => {
    const harness = new MetricsHarness();
    const transport = instrumentTransport(harness.meter, async () => reply(502, "<html>bad gateway</html>"));

    await transport(URL_OF, { method: "POST", headers: {}, body: "{}" });

    expect((await recorded(harness)).points[0]?.attributes).toMatchObject({ "error.type": "http_502" });
  });

  test("test_a_call_that_gets_no_response_records_a_request_error_and_rethrows", async () => {
    const harness = new MetricsHarness();
    const down = new Error("connection refused");
    const transport = instrumentTransport(harness.meter, async () => Promise.reject(down));

    await expect(transport(URL_OF, { method: "POST", headers: {}, body: "{}" })).rejects.toBe(down);

    expect((await recorded(harness)).points[0]?.attributes).toMatchObject({ "error.type": "request" });
  });
});
