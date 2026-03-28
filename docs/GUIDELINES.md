# Documentation Guidelines for WoofX3 Services

This document outlines the rules and conventions for creating and updating documentation for WoofX3 services.

## Overview

WoofX3 uses an automated documentation generation system that:
- Parses TypeScript source files using `ts-morph`
- Extracts public API (classes, interfaces, functions, types)
- Includes JSDoc comments when present
- Generates VitePress-compatible Markdown
- Links to GitHub source files

## Documented Files

Each service should have:
1. **`docs/{service}/config.json`** - Configuration defining source files to document
2. **`docs/{service}/index.md`** - Auto-generated overview
3. **`docs/{service}/{filename}.md`** - Generated API docs per source file

## Service Configuration

Each service needs a `config.json` file:

```json
{
  "name": "servicename",
  "title": "Service Title",
  "description": "Brief description of what the service does",
  "repoBase": "https://github.com/wolfymaster/woofx3",
  "sourceDir": "path/to/service/src",
  "entries": [
    { "file": "main.ts", "title": "Main Entry" },
    { "file": "services/api.ts", "title": "API Service" }
  ]
}
```

### Configuration Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Service identifier (kebab-case) |
| `title` | Yes | Display title for navigation |
| `description` | Yes | Brief description for overview |
| `repoBase` | Yes | GitHub repository base URL |
| `sourceDir` | Yes | Relative path to TypeScript source |
| `entries` | Yes | Array of files to document |

## Adding a New Service

1. Create directory: `docs/{service}/`
2. Create `config.json` with source file entries
3. Run: `bun run docs:generate {service}`
4. Verify with: `bun run docs:build`

## Updating Existing Documentation

When the source code changes:

1. **Re-run the generator** to update API docs:
   ```bash
   bun run docs:generate {service}
   ```

2. **Manual updates** to `index.md` may be needed for:
   - High-level overview text
   - Architecture explanations
   - Usage examples
   - Tutorial content

## Generated Output Format

### Classes

```markdown
## ClassName

Class description from JSDoc.

*extends BaseClass | implements Interface1, Interface2*

**Source:** `file.ts#L10`

### Properties

| Property | Type | readonly | |
|----------|------|----------|-|
| propName | `string` | ✓ | `source` |

### Methods

#### methodName

```typescript
ClassName.methodName(param1: string, param2?: number): Promise<void>
```

Method description from JSDoc.

**Source:** `file.ts#L30`
```

### Interfaces

Similar to classes but for interface definitions.

### Functions

```markdown
## functionName

```typescript
function functionName(param: string): number
```

Description from JSDoc.

**Source:** `file.ts#L15`
```

### Type Aliases

```markdown
## TypeName

```typescript
type TypeName = string | number
```

Description from JSDoc.

**Source:** `file.ts#L5`
```

## Cross-References

VitePress automatically generates anchors from headings. To link to a class or method:

```markdown
See the [Commands class](#commands) for details.

See [Commands.add()](#commandsadd) for more info.
```

## GitHub Links

All source links automatically use the current git branch. To change the branch:

1. Edit `config.json` and add `"branch": "your-branch"`
2. Or ensure you're on the correct branch when generating

## JSDoc Conventions

While the generator works without JSDoc, for best documentation:

```typescript
/**
 * Brief description of what this does.
 * 
 * @param param1 - Description of first parameter
 * @param param2 - Description of optional parameter
 * @returns What is returned
 */
export function myFunction(param1: string, param2?: number): Promise<void> {
  // ...
}
```

## Running the Generator

```bash
# Generate specific service
bun run docs:generate woofwoofwoof

# Generate all services
bun run docs:generate all

# Build docs
bun run docs:build

# Preview docs
bun run docs:preview
```

## File Organization

```
docs/
├── GUIDELINES.md           # This file
├── scripts/
│   ├── generate.ts        # Main entry point
│   ├── parser.ts         # TypeScript parsing
│   ├── markdown.ts       # Markdown generation
│   └── config.ts        # Config loading
├── woofwoofwoof/
│   ├── config.json
│   ├── index.md
│   ├── application.md
│   └── ...
└── services/
    └── runtime.md
```

## Notes for LLM

When instructed to update documentation:

1. **Always read** `docs/GUIDELINES.md` first
2. **Check** `docs/{service}/config.json` to understand source files
3. **Run** `bun run docs:generate {service}` after changing source files
4. **Never manually edit** generated API files - they will be overwritten
5. **Do edit** `index.md` for manual content
6. **Verify** changes with `bun run docs:build`
