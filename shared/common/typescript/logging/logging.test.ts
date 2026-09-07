import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveConfig } from "./logger";
import { makeLogFileName, makeTraceFileName } from "./naming";

const otelEnvKeys = [
  "WOOFX3_OTEL_ENABLED",
  "WOOFX3_OTEL_EXPORTER_ENDPOINT",
  "WOOFX3_OTEL_LOCAL_FILE_ENABLED",
  "WOOFX3_OTEL_TRACING_ENABLED",
];

function clearOtelEnv(): void {
  for (const key of otelEnvKeys) {
    delete process.env[key];
  }
}

describe("resolveConfig OTel defaults", () => {
  beforeEach(clearOtelEnv);
  afterEach(clearOtelEnv);

  test("everything OTel is off when nothing is configured", () => {
    const config = resolveConfig();
    expect(config.otelEnabled).toBe(false);
    expect(config.otelTracingEnabled).toBe(false);
    expect(config.otelExporterEndpoint).toBe("");
    expect(config.otelLocalFileEnabled).toBe(true);
  });

  test("an exporter endpoint turns OTel and tracing on", () => {
    process.env.WOOFX3_OTEL_EXPORTER_ENDPOINT = "http://localhost:4318";
    const config = resolveConfig();
    expect(config.otelEnabled).toBe(true);
    expect(config.otelTracingEnabled).toBe(true);
  });

  test("WOOFX3_OTEL_ENABLED=false overrides the endpoint default", () => {
    process.env.WOOFX3_OTEL_EXPORTER_ENDPOINT = "http://localhost:4318";
    process.env.WOOFX3_OTEL_ENABLED = "false";
    const config = resolveConfig();
    expect(config.otelEnabled).toBe(false);
    expect(config.otelTracingEnabled).toBe(false);
  });

  test("tracing can be force-enabled without a collector", () => {
    process.env.WOOFX3_OTEL_TRACING_ENABLED = "true";
    const config = resolveConfig();
    expect(config.otelEnabled).toBe(false);
    expect(config.otelTracingEnabled).toBe(true);
  });

  test("tracing can be disabled while logs still export", () => {
    process.env.WOOFX3_OTEL_EXPORTER_ENDPOINT = "http://localhost:4318";
    process.env.WOOFX3_OTEL_TRACING_ENABLED = "0";
    const config = resolveConfig();
    expect(config.otelEnabled).toBe(true);
    expect(config.otelTracingEnabled).toBe(false);
  });

  test("explicit overrides beat the environment", () => {
    process.env.WOOFX3_OTEL_EXPORTER_ENDPOINT = "http://localhost:4318";
    const config = resolveConfig({ otelEnabled: false, otelTracingEnabled: false });
    expect(config.otelEnabled).toBe(false);
    expect(config.otelTracingEnabled).toBe(false);
  });
});

describe("file naming", () => {
  test("trace files mirror the log file convention", () => {
    const now = new Date(2026, 8, 6, 4, 7);
    expect(makeLogFileName("api", now)).toBe("api_20260906_0407.log");
    expect(makeTraceFileName("api", now)).toBe("api_traces_20260906_0407.log");
  });
});

async function runScenario(env: Record<string, string>, logDir: string): Promise<{ stdout: string }> {
  const script = `
    import { createServiceLogger, withSpan } from "${import.meta.dir}/index";
    const logger = createServiceLogger({ serviceName: "scenario", logDir: ${JSON.stringify(logDir)} });
    await withSpan("scenario.work", async () => {
      logger.info("inside span", { unit: 1 });
    });
    const { shutdownTelemetry } = await import("${import.meta.dir}/otel");
    await shutdownTelemetry();
  `;
  const proc = Bun.spawn(["bun", "-e", script], {
    env: { ...process.env, ...env, WOOFX3_LOG_DIR: logDir },
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`scenario exited ${code}: ${stderr}`);
  }
  return { stdout };
}

describe("createServiceLogger telemetry wiring", () => {
  let logDir = "";

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "woofx3-logging-"));
  });

  afterEach(() => {
    fs.rmSync(logDir, { force: true, recursive: true });
  });

  test("no collector: console and file behave as before, no trace file", async () => {
    const { stdout } = await runScenario({}, logDir);
    const parsed = JSON.parse(stdout);
    expect(parsed.message).toBe("inside span");
    expect(parsed.service).toBe("scenario");
    expect(parsed.metadata).toEqual({ unit: 1 });
    expect(parsed.traceId).toBeUndefined();
    expect(parsed.spanId).toBeUndefined();

    const files = fs.readdirSync(logDir);
    expect(files.some((name) => name.includes("_traces_"))).toBe(false);
    expect(files.some((name) => name.startsWith("scenario_"))).toBe(true);
  });

  test("tracing forced on without a collector writes spans to a local file", async () => {
    await runScenario({ WOOFX3_OTEL_TRACING_ENABLED: "true" }, logDir);

    const traceFile = fs.readdirSync(logDir).find((name) => name.includes("_traces_"));
    expect(traceFile).toBeDefined();
    const lines = fs
      .readFileSync(path.join(logDir, traceFile as string), "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(lines.length).toBe(1);
    const span = JSON.parse(lines[0] as string);
    expect(span.name).toBe("scenario.work");
    expect(span.service).toBe("scenario");
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  test("tracing forced on stamps trace ids onto log records", async () => {
    const { stdout } = await runScenario({ WOOFX3_OTEL_TRACING_ENABLED: "true" }, logDir);
    const parsed = JSON.parse(stdout);
    expect(parsed.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(parsed.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  test("local file fallback can be turned off", async () => {
    await runScenario({ WOOFX3_OTEL_LOCAL_FILE_ENABLED: "false", WOOFX3_OTEL_TRACING_ENABLED: "true" }, logDir);
    const files = fs.readdirSync(logDir);
    expect(files.some((name) => name.includes("_traces_"))).toBe(false);
  });
});

describe("createServiceLogger against a collector", () => {
  let logDir = "";

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "woofx3-logging-otlp-"));
  });

  afterEach(() => {
    fs.rmSync(logDir, { force: true, recursive: true });
  });

  test("logs and traces are POSTed to the configured OTLP endpoint", async () => {
    const received: string[] = [];
    const collector = Bun.serve({
      fetch: async (req) => {
        received.push(new URL(req.url).pathname);
        await req.arrayBuffer();
        return new Response("{}", { headers: { "Content-Type": "application/json" } });
      },
      port: 0,
    });

    try {
      const { stdout } = await runScenario(
        { WOOFX3_OTEL_EXPORTER_ENDPOINT: `http://127.0.0.1:${collector.port}` },
        logDir
      );
      // Console and file sinks stay intact when the bridge is active.
      expect(JSON.parse(stdout).message).toBe("inside span");
      expect(received).toContain("/v1/logs");
      expect(received).toContain("/v1/traces");
      // A collector is configured, so nothing falls back to a local trace file.
      expect(fs.readdirSync(logDir).some((name) => name.includes("_traces_"))).toBe(false);
    } finally {
      collector.stop(true);
    }
  });
});
