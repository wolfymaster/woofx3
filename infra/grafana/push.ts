// Uploads the generated dashboards to a Grafana stack.
// Run: GRAFANA_URL=https://<stack>.grafana.net GRAFANA_TOKEN=<service account token> bun infra/grafana/push.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.GRAFANA_URL;
const token = process.env.GRAFANA_TOKEN;
if (!url || !token) {
  throw new Error("GRAFANA_URL and GRAFANA_TOKEN are required");
}

const dir = join(import.meta.dir, "dashboards");
for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
  const dashboard = JSON.parse(readFileSync(join(dir, file), "utf8")) as { uid: string };
  const response = await fetch(`${url.replace(/\/$/, "")}/api/dashboards/db`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ dashboard: { ...dashboard, id: null }, overwrite: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${file}: Grafana answered ${response.status}: ${await response.text()}`);
  }
  console.log(`${dashboard.uid}: uploaded`);
}
