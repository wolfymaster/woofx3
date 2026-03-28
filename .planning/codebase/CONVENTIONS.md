# Coding Conventions

> Generated: 2026-01-14 (Refreshed)

## Code Formatting

### Biome Configuration (`biome.json`)

| Setting | Value |
|---------|-------|
| Indent Style | space (2 spaces) |
| Line Width | 120 characters |
| Line Ending | lf |
| Quote Style | double quotes |
| Trailing Commas | es5 |
| Semicolons | always |
| Arrow Parentheses | always |
| Bracket Spacing | true |

## Naming Conventions

### Files

| Type | Convention | Examples |
|------|------------|----------|
| Classes | PascalCase | `Application.ts`, `Manager.ts`, `BitHandler.ts` |
| Utilities | camelCase | `utils.ts`, `helpers.ts` |
| Domain files | lowercase | `nats.ts`, `commands.ts`, `types.ts` |
| Service files | *.service.ts or PascalCase | `MessageBusService.ts` |
| Entry points | descriptive | `api.ts`, `index.ts`, `woofwoofwoof.ts` |

### Code Elements

| Element | Convention | Examples |
|---------|------------|----------|
| Classes | PascalCase | `MessageBusService`, `TwitchApi`, `Commands` |
| Interfaces | PascalCase | `Service<T>`, `Application`, `RuntimeConfig` |
| Types | PascalCase | `HandlerResponse<T>`, `CommandResponse` |
| Functions | camelCase | `createApplication`, `createRuntime`, `canUse` |
| Variables | camelCase | `applicationId`, `channelName`, `messageBus` |
| Constants | camelCase | `healthcheck`, `connected` |

## TypeScript Patterns

### Type Organization

- Types inline or in dedicated `types.ts` files
- Type-only imports with `type` keyword
- Barrel exports in `index.ts` files

```typescript
// Type-only import
import type { Service } from "./service";
import type { HelixUser } from "@twurple/api";

// Barrel export
export * from './events';
export { default as MessageBus } from './index';
```

### Interface vs Type

**Use interfaces for:**
- Service contracts
- Application interfaces
- Configuration objects

```typescript
export interface Service<T> {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly client: T;
  readonly connected: boolean;
}
```

**Use types for:**
- Discriminated unions
- Response types
- Function signatures

```typescript
export type HandlerResponse<T> =
  | { error: false; payload?: T }
  | { error: true; errorMsg: string };
```

### Generics Patterns

```typescript
// Generic constraints
<TContext extends { services: ServicesRegistry }>

// Helper types for extraction
type ExtractContext<T> = T extends { __finalContextType: infer TCtx } ? TCtx : never;
```

## Import Organization

**Order:**
1. Node.js built-in modules (with `node:` prefix)
2. Third-party dependencies
3. Shared workspace packages (via path aliases)
4. Local relative imports
5. Type imports (with `type` keyword)

```typescript
// 1. Node.js built-in
import path from "node:path";

// 2. Third-party
import dotenv from "dotenv";
import { createActor } from "xstate";

// 3. Shared workspace
import { createApplication, createRuntime } from "@woofx3/common/runtime";
import MessageBus from "@woofx3/nats";

// 4. Local imports
import Bootstrap from "./bootstrap";
import { Commands } from "./commands";

// 5. Type imports
import type { WoofWoofWoofApplication } from './application';
```

## Error Handling

### Discriminated Union Pattern

```typescript
export type HandlerResponse<T> = SuccessHandlerResponse<T> | ErrorHandlerResponse<T>;

export type SuccessHandlerResponse<T> = {
  error: false;
  payload?: T;
};

export type ErrorHandlerResponse<T> = {
  error: true;
  errorMsg: string;
};

// Usage
async function getChatters(): Promise<HandlerResponse<HelixChatChatter[]>> {
  try {
    const chatters = await apiClient.chat.getChatters(broadcaster);
    return { error: false, payload: chatters.data };
  } catch (err) {
    return { error: true, errorMsg: (err as Error).message };
  }
}
```

### Try-Catch Pattern

```typescript
// Silent error handling (for watchers)
try(f: any) {
  try {
    f();
  } catch(err) {}
}

// Error throwing for required config
if (!channel) {
  throw new Error("twitch channel missing. please set environment variable: TWITCH_CHANNEL_NAME.");
}
```

## Logging

### Winston Logger Pattern

```typescript
import winston, { LoggerOptions } from 'winston';

export function makeLogger(opts?: LoggerOptions): winston.Logger {
  const { combine, prettyPrint } = winston.format;
  const logger = winston.createLogger({
    format: combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
    ),
    transports: [
      new winston.transports.Console({
        format: combine(winston.format.json(), prettyPrint())
      }),
    ],
    ...opts,
  });
  return logger;
}

// Usage
ctx.logger.info('getBroadcastId', { username });
ctx.logger.error(err);
```

## XState Conventions

### Event Definitions

```typescript
export type RuntimeEvent =
  | { type: "SERVICES_READY" }
  | { type: "HEALTH_CHECK_FAILED" }
  | { type: "HEALTH_CHECK_PASSED" }
  | { type: "SERVICES_CONNECTED" }
  | { type: "APPLICATION_STARTED" }
  | { type: "APPLICATION_TERMINATED" }
  | { type: "SHUTDOWN" }
  | { type: "RESTART_APPLICATION" }
  | { type: "ERROR"; error: Error };
```

### Actor Patterns

```typescript
// Promise-based actors
fromPromise(async ({ input }: { input: RuntimeContext<TContext> }) => {
  await input.application.init();
})

// Callback-based actors
fromCallback(({ input, sendBack }: {
  input: RuntimeContext<TContext>;
  sendBack: (evt: RuntimeEvent) => void
}) => {
  input.application.run();
})
```

## Async Patterns

### Standard Async/Await

```typescript
// Sequential initialization
const bus = await MessageBus.createMessageBus(config);
await twitchClient.init(authConfig);
const chatClient = twitchClient.ChatClient();

// Parallel execution
await Promise.all(services.map((service) => service.connect()));
```

## Service Lifecycle Pattern

```typescript
export interface Service<T> {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly client: T;
  readonly connected: boolean;
  healthcheck: boolean;
  name: string;
  type: string;
}
```

## Bootstrap Pattern

```typescript
export default async function Bootstrap(): Promise<AppConfig> {
  // 1. Read configuration
  const config = readConfigFile();
  const configuration = mergeConfigWithEnvironment(config, process.env);

  // 2. Validate required config
  if (!configuration.twitchChannelName) {
    throw new Error("twitch channel missing");
  }

  // 3. Initialize clients
  const bus = await MessageBus.createMessageBus({...});
  const twitchClient = new TwitchClient({...});
  await twitchClient.init({...});

  // 4. Return typed config
  return {
    channelName: channel,
    config: configuration,
    services: { bus, chatClient, ... }
  };
}
```

## Comment Style

- Minimal comments - code should be self-documenting
- JSDoc for public APIs in shared libraries
- TODO comments for known issues

```typescript
/**
 * Creates a heartbeat function that publishes heartbeat messages to NATS.
 * This should be passed to ApplicationRuntime as the heartbeat option.
 */
export function createNATSHeartbeat(...): () => Promise<void> {
  // ...
}

// TODO: FIX: This outer loop is being called for every msg
// can probably cache as a map
```
