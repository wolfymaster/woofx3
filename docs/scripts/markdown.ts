import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ParsedClass, ParsedFile, ParsedFunction, ParsedInterface, ParsedTypeAlias } from "./parser.js";

export interface MarkdownConfig {
  repoBase: string;
  branch?: string;
  outputDir: string;
}

function getBranch(): string {
  try {
    return execSync("git branch --show-current", { encoding: "utf-8" }).trim() || "main";
  } catch {
    return "main";
  }
}

function escapeMarkdown(text: string): string {
  // Escape HTML-like characters that VitePress might interpret
  return text.replace(/</g, "\\<").replace(/>/g, "\\>");
}

function toAnchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function sourceLink(relativePath: string, line: number, repoBase: string, branch: string): string {
  return `[${relativePath}#L${line}](${repoBase}/blob/${branch}/${relativePath}#L${line})`;
}

function generateClassMarkdown(cls: ParsedClass, repoBase: string, branch: string, relativePath: string): string {
  let md = `## ${cls.name}\n\n`;

  if (cls.jsdoc) {
    md += `${cls.jsdoc}\n\n`;
  }

  if (cls.extends || cls.implements) {
    const heritage: string[] = [];
    if (cls.extends) heritage.push(`extends ${escapeMarkdown(cls.extends)}`);
    if (cls.implements) heritage.push(`implements ${cls.implements.map((e) => escapeMarkdown(e)).join(", ")}`);
    md += `*${heritage.join(" | ")}*\n\n`;
  }

  md += `**Source:** ${sourceLink(relativePath, cls.line, repoBase, branch)}\n\n`;

  if (cls.properties.length > 0) {
    md += `### Properties\n\n`;
    md += `| Property | Type | readonly | |\n`;
    md += `|----------|------|----------|-|\n`;
    for (const prop of cls.properties) {
      const readonly = prop.isReadonly ? "✓" : "";
      const optional = prop.hasQuestionToken ? "?" : "";
      md += `| ${prop.name}${optional} | \`${prop.type}\` | ${readonly} | ${sourceLink(relativePath, prop.line, repoBase, branch)} |\n`;
    }
    md += "\n";
  }

  if (cls.methods.length > 0) {
    md += `### Methods\n\n`;
    for (const method of cls.methods) {
      md += `#### ${method.name}\n\n`;
      md += "```typescript\n";
      md += `${cls.name}.${method.name}${method.signature}\n`;
      md += "```\n\n";
      if (method.jsdoc) {
        md += `${method.jsdoc}\n\n`;
      }
      md += `**Source:** ${sourceLink(relativePath, method.line, repoBase, branch)}\n\n`;
    }
  }

  return md;
}

function generateInterfaceMarkdown(
  iface: ParsedInterface,
  repoBase: string,
  branch: string,
  relativePath: string
): string {
  let md = `## ${iface.name}\n\n`;

  if (iface.jsdoc) {
    md += `${iface.jsdoc}\n\n`;
  }

  if (iface.extends) {
    md += `*extends ${iface.extends.join(", ")}*\n\n`;
  }

  md += `**Source:** ${sourceLink(relativePath, iface.line, repoBase, branch)}\n\n`;

  if (iface.properties.length > 0) {
    md += `### Properties\n\n`;
    md += `| Property | Type | readonly | |\n`;
    md += `|----------|------|----------|-|\n`;
    for (const prop of iface.properties) {
      const readonly = prop.isReadonly ? "✓" : "";
      const optional = prop.hasQuestionToken ? "?" : "";
      md += `| ${prop.name}${optional} | \`${prop.type}\` | ${readonly} | ${sourceLink(relativePath, prop.line, repoBase, branch)} |\n`;
    }
    md += "\n";
  }

  if (iface.methods.length > 0) {
    md += `### Methods\n\n`;
    for (const method of iface.methods) {
      md += `#### ${method.name}\n\n`;
      md += "```typescript\n";
      md += `${iface.name}.${method.name}${method.signature}\n`;
      md += "```\n\n";
      if (method.jsdoc) {
        md += `${method.jsdoc}\n\n`;
      }
      md += `**Source:** ${sourceLink(relativePath, method.line, repoBase, branch)}\n\n`;
    }
  }

  return md;
}

function generateFunctionMarkdown(fn: ParsedFunction, repoBase: string, branch: string, relativePath: string): string {
  let md = `## ${fn.name}\n\n`;
  md += "```typescript\n";
  md += `function ${fn.name}${fn.signature}\n`;
  md += "```\n\n";

  if (fn.jsdoc) {
    md += `${fn.jsdoc}\n\n`;
  }

  md += `**Source:** ${sourceLink(relativePath, fn.line, repoBase, branch)}\n\n`;

  return md;
}

function generateTypeAliasMarkdown(
  typeAlias: ParsedTypeAlias,
  repoBase: string,
  branch: string,
  relativePath: string
): string {
  let md = `## ${typeAlias.name}\n\n`;
  md += "```typescript\n";
  md += `type ${typeAlias.name} = ${typeAlias.type}\n`;
  md += "```\n\n";

  if (typeAlias.jsdoc) {
    md += `${typeAlias.jsdoc}\n\n`;
  }

  md += `**Source:** ${sourceLink(relativePath, typeAlias.line, repoBase, branch)}\n\n`;

  return md;
}

function generateExportMarkdown(
  exp: { name: string; type: string; jsdoc: string; line: number },
  repoBase: string,
  branch: string,
  relativePath: string
): string {
  let md = `## ${exp.name}\n\n`;
  md += `*${exp.type}*\n\n`;

  if (exp.jsdoc) {
    md += `${exp.jsdoc}\n\n`;
  }

  md += `**Source:** ${sourceLink(relativePath, exp.line, repoBase, branch)}\n\n`;

  return md;
}

export function generateFileMarkdown(parsedFile: ParsedFile, config: MarkdownConfig): string {
  const branch = config.branch || getBranch();
  let md = "";

  // Add JSDoc from file if available
  md += "\n";

  // Classes
  for (const cls of parsedFile.classes) {
    md += generateClassMarkdown(cls, config.repoBase, branch, parsedFile.relativePath);
  }

  // Interfaces
  for (const iface of parsedFile.interfaces) {
    md += generateInterfaceMarkdown(iface, config.repoBase, branch, parsedFile.relativePath);
  }

  // Type aliases
  for (const typeAlias of parsedFile.typeAliases) {
    md += generateTypeAliasMarkdown(typeAlias, config.repoBase, branch, parsedFile.relativePath);
  }

  // Functions
  for (const fn of parsedFile.functions) {
    md += generateFunctionMarkdown(fn, config.repoBase, branch, parsedFile.relativePath);
  }

  // Other exports
  for (const exp of parsedFile.exports) {
    // Skip if already documented as class/interface/function/type
    const alreadyDocumented =
      parsedFile.classes.some((c) => c.name === exp.name) ||
      parsedFile.interfaces.some((i) => i.name === exp.name) ||
      parsedFile.functions.some((f) => f.name === exp.name) ||
      parsedFile.typeAliases.some((t) => t.name === exp.name);

    if (!alreadyDocumented) {
      md += generateExportMarkdown(exp, config.repoBase, branch, parsedFile.relativePath);
    }
  }

  return md;
}

export function generateOverviewMarkdown(
  serviceName: string,
  serviceTitle: string,
  description: string,
  parsedFiles: ParsedFile[]
): string {
  // Collect all exported items
  const allExports: { name: string; type: string; description: string }[] = [];

  for (const pf of parsedFiles) {
    for (const cls of pf.classes) {
      allExports.push({ name: cls.name, type: "class", description: cls.jsdoc?.split("\n")[0] || "" });
    }
    for (const iface of pf.interfaces) {
      allExports.push({ name: iface.name, type: "interface", description: iface.jsdoc?.split("\n")[0] || "" });
    }
    for (const fn of pf.functions) {
      allExports.push({ name: fn.name, type: "function", description: fn.jsdoc?.split("\n")[0] || "" });
    }
    for (const ta of pf.typeAliases) {
      allExports.push({ name: ta.name, type: "type", description: ta.jsdoc?.split("\n")[0] || "" });
    }
  }

  let md = `# ${serviceTitle}\n\n`;
  md += `${description}\n\n`;
  md += `## Overview\n\n`;
  md += `This service consists of the following modules:\n\n`;

  for (const pf of parsedFiles) {
    const fileName = pf.relativePath.split("/").pop()?.replace(".ts", "") || pf.relativePath;
    md += `- **${fileName}** - ${pf.relativePath}\n`;
  }

  md += "\n## API Reference\n\n";

  if (allExports.length > 0) {
    md += `| Name | Type | Description |\n`;
    md += `|------|------|-------------|\n`;
    for (const exp of allExports) {
      md += `| ${exp.name} | ${exp.type} | ${exp.description.slice(0, 60)} |\n`;
    }
  }

  return md;
}

export function writeMarkdown(content: string, outputPath: string): void {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outputPath, content, "utf-8");
}
