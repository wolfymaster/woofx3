import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveConfig } from "./logger";
import { buildLoggerProvider, buildResource } from "./otel";
import { parseOtelPairs } from "./otel-pairs";

const envKeys = ["WOOFX3_OTEL_RESOURCE_ATTRIBUTES", "WOOFX3_OTEL_EXPORTER_HEADERS", "WOOFX3_VERSION"];

function clearEnv(): void {
  for (const key of envKeys) {
    delete process.env[key];
  }
}

describe("parseOtelPairs", () => {
  const cases: Array<{ name: string; raw: string | undefined; want: Record<string, string> }> = [
    { name: "unset is empty", raw: undefined, want: {} },
    { name: "empty string is empty", raw: "", want: {} },
    { name: "single pair", raw: "a=b", want: { a: "b" } },
    { name: "whitespace is trimmed", raw: " a = b , c=d ", want: { a: "b", c: "d" } },
    { name: "empty segments are ignored", raw: "a=b,,c=d,", want: { a: "b", c: "d" } },
    {
      name: "value keeps later equals signs",
      raw: "authorization=Basic abc==",
      want: { authorization: "Basic abc==" },
    },
    { name: "later duplicate wins", raw: "a=1,a=2", want: { a: "2" } },
    {
      name: "percent-decodes values",
      raw: "authorization=Basic%20abc%3D%3D,k=a%2Cb",
      want: { authorization: "Basic abc==", k: "a,b" },
    },
    { name: "plus stays plus", raw: "a=1+2", want: { a: "1+2" } },
    { name: "percent-decodes keys", raw: "a%2Eb=1", want: { "a.b": "1" } },
    { name: "empty value is allowed", raw: "a=", want: { a: "" } },
  ];
  for (const { name, raw, want } of cases) {
    test(name, () => {
      expect(parseOtelPairs(raw, "X")).toEqual(want);
    });
  }

  test("a bad percent-escape throws without echoing the value", () => {
    expect(() => parseOtelPairs("a=%zzhunter2", "WOOFX3_OTEL_EXPORTER_HEADERS")).toThrow(
      "WOOFX3_OTEL_EXPORTER_HEADERS has an invalid percent-escape"
    );
  });

  for (const raw of ["novalue", "=v", " =v"]) {
    test(`malformed ${JSON.stringify(raw)} throws without echoing the pair`, () => {
      expect(() => parseOtelPairs(raw, "WOOFX3_OTEL_EXPORTER_HEADERS")).toThrow(
        "WOOFX3_OTEL_EXPORTER_HEADERS must be comma-separated key=value pairs; a pair has no key"
      );
    });
  }
});

describe("resolveConfig OTel resource keys", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test("unset keys leave nothing configured", () => {
    const config = resolveConfig();
    expect(config.otelResourceAttributes).toEqual({});
    expect(config.otelExporterHeaders).toEqual({});
    expect(config.serviceVersion).toBe("");
  });

  test("reads attributes, headers and version from the environment", () => {
    process.env.WOOFX3_OTEL_RESOURCE_ATTRIBUTES = "service.namespace=eng-1,woofx3.engine.id=7";
    process.env.WOOFX3_OTEL_EXPORTER_HEADERS = "authorization=Basic xyz";
    process.env.WOOFX3_VERSION = "v1.2.3";
    const config = resolveConfig();
    expect(config.otelResourceAttributes).toEqual({ "service.namespace": "eng-1", "woofx3.engine.id": "7" });
    expect(config.otelExporterHeaders).toEqual({ authorization: "Basic xyz" });
    expect(config.serviceVersion).toBe("v1.2.3");
  });

  test("a malformed attribute list fails config resolution", () => {
    process.env.WOOFX3_OTEL_RESOURCE_ATTRIBUTES = "oops";
    expect(() => resolveConfig()).toThrow("WOOFX3_OTEL_RESOURCE_ATTRIBUTES");
  });
});

describe("buildResource", () => {
  test("merges attributes and version, and service.name always wins", () => {
    const config = {
      ...resolveConfig(),
      otelResourceAttributes: { "service.name": "impostor", "service.namespace": "eng-1" },
      serviceVersion: "v1.2.3",
    };
    const attributes = buildResource("api", config).attributes;
    expect(attributes["service.name"]).toBe("api");
    expect(attributes["service.namespace"]).toBe("eng-1");
    expect(attributes["service.version"]).toBe("v1.2.3");
  });

  test("omits service.version when none is configured", () => {
    expect(buildResource("api", resolveConfig()).attributes["service.version"]).toBeUndefined();
  });
});

describe("OTLP log export headers", () => {
  test("sends the configured headers on every request", async () => {
    const seen: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        seen.push(request.headers.get("authorization"));
        return new Response("{}", { headers: { "content-type": "application/json" } });
      },
    });
    try {
      const config = { ...resolveConfig(), otelExporterHeaders: { authorization: "Basic xyz" } };
      const provider = buildLoggerProvider("api", `http://127.0.0.1:${server.port}`, config);
      provider.getLogger("test").emit({ body: "hello" });
      await provider.forceFlush();
      await provider.shutdown();
      expect(seen).toEqual(["Basic xyz"]);
    } finally {
      await server.stop(true);
    }
  });
});
