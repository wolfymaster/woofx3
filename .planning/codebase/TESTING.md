# Testing

> Generated: 2026-01-14 (Refreshed)

## Current State

**Testing is minimal in this codebase.** Jest is installed but no actual test files exist in the source directories.

## Test Framework

| Framework | Version | Location |
|-----------|---------|----------|
| **Jest** | ^29.0.0 | `shared/clients/typescript/nats/package.json` |
| **@types/jest** | ^29.0.0 | Dev dependency |

## Test Configuration

No dedicated Jest configuration files found:
- No `jest.config.js` at root
- No `jest.config.ts` in services
- Jest uses default configuration

## Test File Locations

**No test files found in:**
- `twitch/src/` - No `.test.ts` or `.spec.ts` files
- `woofwoofwoof/src/` - No test files
- `shared/` - No test files
- `streamlabs/` - No test files

**Only test-like files found:**
- `streamlabs/obstest.ts` - Manual OBS test script
- `barkloader/lib_sandbox/tests/` - Rust tests

## Test Scripts

```json
// shared/clients/typescript/nats/package.json
{
  "scripts": {
    "test": "jest"
  }
}
```

Running `npm test` would use Jest with default configuration and find no tests.

## Recommended Test Structure

For future implementation:

```
service/
├── src/
│   ├── __tests__/           # Test directory
│   │   ├── unit/           # Unit tests
│   │   ├── integration/    # Integration tests
│   │   └── fixtures/       # Test fixtures
│   ├── application.ts
│   └── application.test.ts  # Co-located tests
├── package.json
└── jest.config.ts
```

## Suggested Test Naming

```
*.test.ts       # Unit tests
*.spec.ts       # Integration/behavior tests
*.e2e.ts        # End-to-end tests
```

## Priority Test Areas

Based on code complexity, these areas should be tested first:

### High Priority
1. **Runtime State Machine** (`shared/common/typescript/runtime/runtime.ts`)
   - State transitions
   - Health check logic
   - Exponential backoff

2. **Command Processing** (`woofwoofwoof/src/commands.ts`)
   - Command matching
   - Permission checking
   - Response handling

3. **Message Bus** (`shared/clients/typescript/messagebus/`)
   - Publish/subscribe
   - Backend switching
   - Error handling

### Medium Priority
4. **Bootstrap Functions** (various `bootstrap.ts`)
   - Configuration validation
   - Service initialization

5. **Twitch Handlers** (`twitch/src/handlers.ts`)
   - API response parsing
   - Error handling

### Low Priority
6. **Utility Functions** (`*/utils.ts`)
   - String parsing
   - Time calculations

## Mock Strategies (Suggested)

```typescript
// Service mocks
jest.mock('@woofx3/nats', () => ({
  createMessageBus: jest.fn().mockResolvedValue({
    publish: jest.fn(),
    subscribe: jest.fn(),
  }),
}));

// External API mocks
jest.mock('@twurple/api', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({
    chat: { getChatters: jest.fn() },
  })),
}));
```

## Test Commands

```bash
# Run all tests (when implemented)
bun test

# Run specific service tests
cd twitch && bun test

# Run with coverage
bun test --coverage

# Watch mode
bun test --watch
```

## Coverage Thresholds (Recommended)

```javascript
// jest.config.ts (to be created)
export default {
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
```

## Gaps to Address

1. **No Unit Tests** - Critical business logic untested
2. **No Integration Tests** - Service interactions untested
3. **No E2E Tests** - User flows untested
4. **No Coverage Reporting** - No visibility into test coverage
5. **No CI/CD Integration** - Tests not run automatically
