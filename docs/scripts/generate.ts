#!/usr/bin/env bun

import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadAllServiceConfigs, loadServiceConfig, type ServiceConfig } from "./config.js";
import { generateFileMarkdown, generateOverviewMarkdown, type MarkdownConfig, writeMarkdown } from "./markdown.js";
import { type ParsedFile, parseService } from "./parser.js";

const DOCS_DIR = resolve(process.cwd());

async function generateService(serviceName: string): Promise<void> {
  console.log(`Generating docs for ${serviceName}...`);

  const config = await loadServiceConfig(serviceName);

  const parsedFiles = parseService(config);

  const markdownConfig: MarkdownConfig = {
    repoBase: config.repoBase,
    outputDir: DOCS_DIR,
  };

  // Generate individual API files
  const outputDir = resolve(DOCS_DIR, serviceName);

  for (const parsedFile of parsedFiles) {
    const fileName = parsedFile.relativePath.split("/").pop()?.replace(".ts", ".md") || "unknown.md";
    const outputPath = join(outputDir, fileName);

    const content = generateFileMarkdown(parsedFile, markdownConfig);
    writeMarkdown(content, outputPath);
    console.log(`  - Generated ${fileName}`);
  }

  // Generate overview/index
  const overviewContent = generateOverviewMarkdown(config.name, config.title, config.description, parsedFiles);
  writeMarkdown(overviewContent, join(outputDir, "index.md"));
  console.log(`  - Generated index.md`);

  console.log(`Done generating docs for ${serviceName}`);
}

async function generateAll(): Promise<void> {
  const configs = await loadAllServiceConfigs();

  for (const config of configs) {
    await generateService(config.name);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const serviceName = args[0];

  if (!serviceName) {
    console.log("Usage: bun run generate.ts <service-name> | all");
    console.log("Example: bun run generate.ts woofwoofwoof");
    process.exit(1);
  }

  if (serviceName === "all") {
    await generateAll();
  } else {
    await generateService(serviceName);
  }
}

main().catch(console.error);
