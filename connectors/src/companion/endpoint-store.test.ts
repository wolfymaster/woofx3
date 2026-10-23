import { afterEach, describe, expect, test } from "bun:test";
import { ModuleResponse } from "@woofx3/db/module.pb";
import { GetModuleSecretValuesResponse, ListModuleSettingsResponse } from "@woofx3/db/module_setting.pb";
import { SettingResponse } from "@woofx3/db/setting.pb";
import { dbProxyClientConfig } from "../services/db-proxy";
import { dbProxyEndpointStore, type EndpointStore } from "./endpoint-store";

const TOKEN = "connectors-db-proxy-token-0123456789abcdef";

type Answer = Uint8Array | { status: number; code: string; msg: string };

/** A db-proxy that answers each Twirp method from a table, as protobuf. */
function fakeDbProxy(answers: Record<string, Answer>) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const method = new URL(request.url).pathname.split("/").pop() ?? "";
      const answer = answers[method];
      if (answer === undefined) {
        return Response.json({ code: "unimplemented", msg: method }, { status: 501 });
      }
      if (answer instanceof Uint8Array) {
        return new Response(new Uint8Array(answer), { headers: { "content-type": "application/protobuf" } });
      }
      return Response.json({ code: answer.code, msg: answer.msg }, { status: answer.status });
    },
  });
  const store = dbProxyEndpointStore(dbProxyClientConfig(`http://127.0.0.1:${server.port}`, TOKEN, 1_000));
  return { server, store };
}

let running: { stop(force: boolean): void } | undefined;

afterEach(() => {
  running?.stop(true);
  running = undefined;
});

function serve(answers: Record<string, Answer>): EndpointStore {
  const { server, store } = fakeDbProxy(answers);
  running = server;
  return store;
}

const settingAnswer = (stringValue: string) =>
  SettingResponse.encode({ setting: { key: "relay.config", value: { stringValue } } as never });

describe("dbProxyEndpointStore", () => {
  test("reads the installed module's manifest", async () => {
    const store = serve({
      GetModuleByModuleId: ModuleResponse.encode({ module: { manifest: '{"local":[]}' } as never }),
    });
    expect(await store.moduleManifest("woofx3_obs")).toBe('{"local":[]}');
  });

  test("reads an unknown module, which db-proxy answers with an empty one, as no manifest", async () => {
    const store = serve({ GetModuleByModuleId: ModuleResponse.encode({}) });
    expect(await store.moduleManifest("woofx3_obs")).toBeNull();
  });

  test("reads the module's settings as key and value", async () => {
    const store = serve({
      ListModuleSettings: ListModuleSettingsResponse.encode({
        settings: [{ key: "host", value: "obs.lan", valueType: "string" } as never],
      }),
    });
    expect(await store.moduleSettings("woofx3_obs")).toEqual([{ key: "host", value: "obs.lan" }]);
  });

  test("opens the module's secrets", async () => {
    const store = serve({
      GetModuleSecretValues: GetModuleSecretValuesResponse.encode({ values: { password: "hunter2" } }),
    });
    expect(await store.moduleSecrets("woofx3_obs")).toEqual({ password: "hunter2" });
  });

  const relayConfigs: Array<[name: string, stored: string, expected: unknown]> = [
    ["nothing stored", "", null],
    ["a value that is not a configuration", "not json", null],
    [
      "a stored configuration",
      JSON.stringify({
        bridgeOrigin: "https://c-abc.woofx3.tv",
        endpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }],
        clientId: "client-1",
      }),
      {
        bridgeOrigin: "https://c-abc.woofx3.tv",
        endpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }],
        clientId: "client-1",
      },
    ],
  ];
  for (const [name, stored, expected] of relayConfigs) {
    test(`reads the relay configuration: ${name}`, async () => {
      const store = serve({ GetSetting: settingAnswer(stored) });
      expect(await store.relayConfig()).toEqual(expected as never);
    });
  }

  test("names the call and db-proxy's error when a read fails", async () => {
    const store = serve({ ListModuleSettings: { status: 500, code: "internal", msg: "database is locked" } });
    await expect(store.moduleSettings("woofx3_obs")).rejects.toThrow(
      "db-proxy ListModuleSettings: internal: database is locked"
    );
  });
});
