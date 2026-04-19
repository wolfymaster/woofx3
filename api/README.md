# WoofX3 API Server

The API server provides a public interface for clients to interact with the WoofX3 system. It uses [Cap'n Web](https://github.com/cloudflare/capnweb) for RPC communication over HTTP batch requests and WebSockets.

## Features

- **Database Access**: Query and manage commands, workflows, users, settings, storage, and treats via the DB proxy
- **Workflow Execution**: Execute workflows manually and monitor their execution status
- **Event Publishing**: Publish events to NATS for triggering workflows or simulating Twitch events

## Architecture

The API server acts as a gateway between clients and the backend services:

- **DB Proxy Client**: Uses Twirp (HTTP-based RPC) to communicate with the database proxy service
- **NATS Client**: Publishes events to the message bus for workflow triggers and event simulation
- **Cap'n Web**: Provides the RPC interface for clients to call API methods

## Configuration

The API server requires the following environment variables:

- `API_PORT`: Port to run the server on (default: 8080)
- `DATABASE_PROXY_URL`: URL of the database proxy service (required)
- `MESSAGE_BUS_URL`: NATS server URL (default: nats://localhost:4222)
- `MESSAGE_BUS_JWT`: Optional JWT for NATS authentication
- `MESSAGE_BUS_NKEY`: Optional NKey seed for NATS authentication

> Note: the default `applicationId` is no longer an env var. It is created (or
> recovered) on first UI onboarding through `api.registerClient(description, { userId })`
> and returned to the caller. The server warms this value at startup when a default
> application already exists; otherwise it is populated lazily on the first
> `registerClient` call.

## Running the Server

```bash
# Install dependencies
bun install

# Start the server
bun run start

# Or in development mode with watch
bun run dev
```

The server will start on the configured port and expose:
- HTTP batch endpoint: `http://localhost:8080/api`
- WebSocket endpoint: `ws://localhost:8080/api`
- Health check: `http://localhost:8080/health`

## API Methods

The API is designed around UI use cases rather than database operations. Methods represent user actions and common workflows.

### Workflows

- `getAvailableWorkflows()`: Get workflows with their status and recent execution info for display
- `triggerWorkflowByName(workflowName: string, parameters?: Record<string, string>, userId?: string)`: Trigger a workflow by name (user-friendly)
- `getWorkflowStatus(executionId: string)`: Get detailed execution status with progress and steps
- `getWorkflowHistory(options)`: Get execution history filtered by workflow name, user, or status
- `cancelWorkflow(executionId: string, reason?: string)`: Cancel a running workflow

### Commands

- `getAvailableCommands(username?: string)`: Get commands available to a user
- `executeCommand(commandName: string, username: string, args?: Record<string, string>)`: Execute a command by name

### User Actions

- `getUserProfile(userId: string)`: Get user profile with stats and treats summary
- `awardTreatsToUser(userId, treatType, title, description, points, awardedBy, ...)`: Award treats to a user

### Events

- `simulateTwitchEvent(eventType: string, eventData: Record<string, unknown>)`: Simulate a Twitch event for testing workflows
- `triggerEvent(eventType: string, eventData: Record<string, unknown>)`: Publish an event to trigger workflows

### Dashboard

- `getDashboard()`: Get system overview with workflow stats and recent activity

## Client Usage

### Using Cap'n Web Client

```typescript
import { newWebSocketRpcSession, RpcStub } from "capnweb";

// Connect via WebSocket
const ws = new WebSocket("ws://localhost:8080/api");
const api: RpcStub<Api> = newWebSocketRpcSession<Api>(ws);

// Call API methods
const workflows = await api.getAvailableWorkflows();
await api.triggerWorkflowByName("VIP Effects", { userId: "user123" });
const status = await api.getWorkflowStatus("execution-id");
await api.simulateTwitchEvent("channel.chat.message", { message: "Hello!" });
const dashboard = await api.getDashboard();
```

### Using HTTP Batch Requests

```typescript
import { newHttpBatchRpcSession, RpcStub } from "capnweb";

// Create HTTP batch session
const api: RpcStub<Api> = newHttpBatchRpcSession<Api>("http://localhost:8080/api");

// Call API methods (same as WebSocket)
const commands = await api.listCommands();
```

## Error Handling

All API methods throw errors if:
- The DB proxy returns a non-OK status code
- Required resources are not found
- Network or connection errors occur

Errors are propagated as exceptions that can be caught by the client.

## Development

The API is built with:
- **TypeScript**: For type safety
- **Bun**: As the runtime
- **Cap'n Web**: For RPC communication
- **Twirp**: For DB proxy communication
- **NATS**: For event publishing

## License

Part of the WoofX3 project.
