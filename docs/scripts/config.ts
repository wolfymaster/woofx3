import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface ServiceEntry {
  file: string;
  title: string;
}

export interface ServiceConfig {
  name: string;
  title: string;
  description: string;
  repoBase: string;
  sourceDir: string;
  entries: ServiceEntry[];
}

export async function loadServiceConfig(serviceName: string): Promise<ServiceConfig> {
  const configPath = resolve(process.cwd(), serviceName, "config.json");
  const content = await readFile(configPath, "utf-8");
  return JSON.parse(content) as ServiceConfig;
}

export async function loadAllServiceConfigs(): Promise<ServiceConfig[]> {
  const fs = await import("node:fs");
  const docsDir = resolve(process.cwd(), "docs");

  const configs: ServiceConfig[] = [];

  const entries = fs.readdirSync(docsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const configPath = resolve(docsDir, entry.name, "config.json");
      if (fs.existsSync(configPath)) {
        try {
          const config = await loadServiceConfig(entry.name);
          configs.push(config);
        } catch (err) {
          console.warn(`Failed to load config for ${entry.name}:`, err);
        }
      }
    }
  }

  return configs;
}
