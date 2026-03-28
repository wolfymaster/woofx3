# Technical Concerns

> Generated: 2026-01-14 (Refreshed)

## Summary

| Severity | Count |
|----------|-------|
| Critical | 4 |
| High | 10 |
| Medium | 7 |
| Low | 8 |

---

## Critical Issues

### 1. Hardcoded Spotify Device ID

**File:** `woofwoofwoof/src/application.ts:207`

```typescript
const deviceId = "02e7cb6b8d5bae01eeb82eb2af0e32e22e044d43";
```

**Risk:** Exposes device identifier in source code.
**Fix:** Move to environment variable.

### 2. Missing Input Validation on Moderation Tool

**File:** `twitch/src/handlers.ts:108-127`

```typescript
const { action, username, duration } = input;
return JSON.stringify({
    command: lowercaseAction,
    args: { user: username }  // UNSANITIZED
});
```

**Risk:** Potential command injection via username parameter.
**Fix:** Validate and sanitize username input.

### 3. Empty Fallback for Admin Tokens

**Files:**
- `streamlabs/server.ts:23`
- `reward/src/StreamLabsHandler.ts:10`

```typescript
const adminToken = process.env.INSTANTDB_ADMIN_TOKEN || "";
```

**Risk:** Service operates with empty token, could fail silently or expose data.
**Fix:** Throw error if required tokens are missing.

### 4. Missing Spotify API Response Validation

**File:** `woofwoofwoof/src/spotify.ts:84-86`

```typescript
const response = await fetch('https://accounts.spotify.com/api/token', {...});
const json = await response.json();  // No status check
this.client = SpotifyApi.withAccessToken(this.clientId, json);
```

**Risk:** Invalid tokens silently proceed, causing downstream failures.
**Fix:** Check `response.ok` before parsing JSON.

---

## High Severity Issues

### 5. Missing Socket Connection Timeout

**File:** `streamlabs/server.ts:44-56`

```typescript
// TODO: Prolly want a timeout on the socket connection
await obs.connect(connectionString, token);  // Can hang indefinitely
```

**Risk:** Application hangs if OBS is unresponsive.
**Fix:** Add AbortController with timeout.

### 6. Unsafe JSON.parse Without Try-Catch

**File:** `barkloader/index.ts:83`

```typescript
const data = JSON.parse(message) as WebSocketMessage;
```

**Risk:** Malformed JSON crashes the process.
**Fix:** Wrap in try-catch.

### 7. No HTTP Response Status Validation

**File:** `twitch/src/handlers.ts:321-330`

```typescript
const response = await fetch("https://api.console.tts.monster/generate", {...});
const data = await response.json();  // Assumes success
```

**Risk:** Error responses silently converted to JSON.
**Fix:** Check `response.ok` before proceeding.

### 8. O(n) Command Lookup Performance

**File:** `woofwoofwoof/src/commands.ts:54-56`

```typescript
// TODO: FIX: This outer loop is being called for every msg
for(let i = 0; i < this.commands.length; ++i) {
```

**Risk:** Linear search on every chat message degrades performance.
**Fix:** Use Map for O(1) lookup.

### 9. Unsafe Type Assertions

**File:** `woofwoofwoof/src/spotify.ts:103`

```typescript
const item: Track = state.item as Track;
// No null check before accessing item.artists[0]
```

**Risk:** Runtime error if artists array is empty.
**Fix:** Add null checks.

### 10. Unhandled Promise Rejections

**File:** `shared/clients/typescript/nats/src/client.ts:74-83`

```typescript
(async () => {
    try {
        for await (const msg of subscription) { ... }
    } catch (error) {
        this.logger.error?.("Subscription error:", error);
        // Silent failure - doesn't re-throw
    }
})();
```

**Risk:** Subscription errors silently swallowed.
**Fix:** Implement proper error propagation.

### 11. Silent Error Handling

**File:** `woofwoofwoof/src/commands.ts`

```typescript
try(f: any) {
  try { f(); } catch(err) {}
}
```

**Risk:** Errors completely hidden, impossible to debug.
**Fix:** At minimum, log errors.

### 12. Missing Null Checks on Array Access

**File:** `woofwoofwoof/src/spotify.ts:27-31`

```typescript
artist: i.artists[0].name,  // No check if artists is empty
```

**Risk:** TypeError if artists array is empty.
**Fix:** Add optional chaining or fallback.

### 13. Extensive `any` Type Usage

**Files:**
- `shared/clients/typescript/messagebus/src/http-backend.ts`
- `shared/clients/typescript/nats/src/client.ts`
- `barkloader/types.ts`
- All `*.pb.ts` files (30+ instances)

**Risk:** Type safety bypassed, runtime errors possible.
**Fix:** Replace with proper TypeScript interfaces.

### 14. Missing Request Timeouts

**File:** `shared/clients/typescript/servicediscovery/index.ts:174`

```typescript
const timeout = setTimeout(() => { ... }, 5000);
// Timeout doesn't actually cancel in-flight requests
```

**Risk:** Requests can hang indefinitely.
**Fix:** Use AbortController.

---

## Medium Severity Issues

### 15. Commented-Out Code (500+ lines)

**File:** `twitch/src/api.ts:35-523`

Massive block of commented event handlers polluting the codebase.

**Fix:** Remove or move to separate branch.

### 16. Missing Database Query Parameterization

**File:** `streamlabs/server.ts:129-137`

```typescript
const query = await db.query({
    counts: { $: { where: { id: countId } } }  // User-controlled
});
```

**Risk:** Potential query injection.
**Fix:** Validate countId before query.

### 17. Missing Input Bounds Checking

**File:** `streamlabs/server.ts:151-152`

```typescript
newCount += args.value;  // No bounds checking
```

**Risk:** Integer overflow.
**Fix:** Validate value bounds.

### 18. Missing CORS Validation

**File:** `services/messagebus-gateway/internal/gateway/gateway.go:81`

```go
// TODO: Implement proper origin checking for production
```

**Risk:** CORS bypass in production.
**Fix:** Implement origin whitelist.

### 19. Inconsistent Logging

Mixed use of `console.log` and Winston logger throughout codebase.

**Files:**
- `shared/clients/typescript/messagebus/src/http-backend.ts`
- `twitch/src/handlers.ts`
- `streamlabs/server.ts`

**Fix:** Standardize on Winston.

### 20. Missing Hot Reload

**File:** `woofwoofwoof/src/application.ts:96`

```typescript
// TODO: Handle hot reloading of commands
```

Commands loaded once at startup; requires restart to update.

### 21. Incomplete Workflow Features

**File:** `wooflow/internal/workflow/temporal/activities.go:37`

```go
// TODO: Implement workflow state persistence
// TODO: Implement wait step handling
```

---

## Low Severity Issues

### 22. Dead Code and TODOs

Multiple TODO comments indicating incomplete features:
- `woofwoofwoof/src/application.ts:388-390` - Missing eval type
- Various `// TODO: FIX` comments

### 23. Excessive Console Logging

Debug `console.log` statements throughout production code.

### 24. Missing Module Checks

**File:** `streamlabs/wsShim.ts:3`

```typescript
const ws = require('ws');  // No error handling
```

### 25. Unvalidated parseInt

**File:** `woofwoofwoof/src/util.ts:34`

```typescript
const num = parseInt(match, 10);  // NaN not checked
```

### 26. Commented Sanitization

**File:** `woofwoofwoof/src/application.ts:384`

```typescript
// const targetUser = input.trim().replace(/[^a-zA-Z0-9\s]/g, "");
```

Sanitization code exists but is commented out.

### 27. Typo in Filename

**File:** `twitch/src/boostrap.ts` (should be `bootstrap.ts`)

### 28. Hardcoded Magic Numbers

Various timeout values and limits without constants.

### 29. Missing Documentation

No JSDoc comments on most public APIs.

---

## Security Summary

| Category | Count |
|----------|-------|
| Missing Input Validation | 8 |
| Hardcoded Secrets | 3 |
| No HTTP Status Validation | 5 |
| Type Safety Issues (any) | 30+ |
| Missing Error Handling | 12 |
| Unsafe JSON.parse | 4 |

---

## Recommended Actions

### Immediate (Critical)
1. Remove hardcoded device ID
2. Add input validation for moderation commands
3. Require admin tokens (throw on missing)
4. Validate API response status codes

### Short-term (High)
5. Add connection timeouts
6. Wrap JSON.parse in try-catch
7. Convert command lookup to Map
8. Add null checks before array access
9. Replace `any` with proper types

### Medium-term
10. Remove 500+ lines of commented code
11. Standardize logging on Winston
12. Add comprehensive test coverage
13. Implement proper CORS validation
14. Add request timeout handling

---

## Technical Debt Tracking

Consider creating issues for each concern:

```
[CRITICAL] SEC-001: Hardcoded Spotify device ID
[CRITICAL] SEC-002: Missing input validation on moderation
[HIGH] PERF-001: O(n) command lookup
[HIGH] REL-001: Missing error handling in NATS subscriptions
[MEDIUM] MAINT-001: Remove commented code blocks
[LOW] DOC-001: Add JSDoc to public APIs
```
