import { describe, expect, test } from "bun:test";
import { parseModuleEndpointRequest } from "@woofx3/common/cloudevents/Companion/module-request";
import { parseRelayConfig } from "@woofx3/common/cloudevents/Relay/relay";

// The relay routes an endpoint by the same ids, so a request the contract
// accepts names an endpoint the relay can route, and the other way round.
// The relay also refuses the module ids "." and "..", which no installed
// module can have; they are left out here.
describe("ids agree with the relay configuration", () => {
  const ids: { moduleId: string; endpointId: string }[] = [
    { moduleId: "vtube_studio", endpointId: "vts" },
    { moduleId: "Acme.Lights-2", endpointId: "bridge_1" },
    { moduleId: "my module", endpointId: "vts" },
    { moduleId: "m".repeat(101), endpointId: "vts" },
    { moduleId: "vtube_studio", endpointId: "VTS" },
    { moduleId: "vtube_studio", endpointId: "e".repeat(41) },
  ];
  for (const { moduleId, endpointId } of ids) {
    test(`${moduleId.slice(0, 20)}/${endpointId.slice(0, 20)}`, () => {
      const contract = parseModuleEndpointRequest({ op: "send", moduleId, endpointId, message: "x", budgetMs: 1000 });
      let relay = true;
      try {
        parseRelayConfig({ bridgeOrigin: "https://c-1.example.test", endpoints: [{ moduleId, endpointId }] });
      } catch {
        relay = false;
      }
      expect(contract.ok).toBe(relay);
    });
  }
});
