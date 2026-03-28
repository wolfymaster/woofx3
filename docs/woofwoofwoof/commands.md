
## Commands

**Source:** [woofwoofwoof/src/commands.ts#L21](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L21)

### Properties

| Property | Type | readonly | |
|----------|------|----------|-|
| commands | `import("/home/wolfy/code/wolfymaster/woofx3/woofwoofwoof/src/commands").Command[]` |  | [woofwoofwoof/src/commands.ts#L22](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L22) |
| watchers | `import("/home/wolfy/code/wolfymaster/woofx3/woofwoofwoof/src/commands").ChatWatcherFunction[]` |  | [woofwoofwoof/src/commands.ts#L23](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L23) |
| auth | `import("/home/wolfy/code/wolfymaster/woofx3/woofwoofwoof/src/commands").AuthorizationFunction` |  | [woofwoofwoof/src/commands.ts#L24](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L24) |

### Methods

#### add

```typescript
Commands.add(command: string, response: import("/home/wolfy/code/wolfymaster/woofx3/woofwoofwoof/src/commands").CommandResponse): unknown
```

**Source:** [woofwoofwoof/src/commands.ts#L30](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L30)

#### every

```typescript
Commands.every(cb: import("/home/wolfy/code/wolfymaster/woofx3/woofwoofwoof/src/commands").ChatWatcherFunction): unknown
```

**Source:** [woofwoofwoof/src/commands.ts#L45](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L45)

#### process

```typescript
Commands.process(text: string, user: string): Promise<[string, boolean]>
```

**Source:** [woofwoofwoof/src/commands.ts#L49](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L49)

#### parseAction

```typescript
Commands.parseAction(text: string): unknown
```

**Source:** [woofwoofwoof/src/commands.ts#L82](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L82)

#### send

```typescript
Commands.send(msg: string, opts?: import("/home/wolfy/code/wolfymaster/woofx3/woofwoofwoof/node_modules/@twurple/chat/lib/ChatMessageAttributes").ChatSayMessageAttributes, parseCommand: boolean): unknown
```

**Source:** [woofwoofwoof/src/commands.ts#L99](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L99)

#### try

```typescript
Commands.try(f: any): unknown
```

**Source:** [woofwoofwoof/src/commands.ts#L110](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L110)

#### checkPermissions

```typescript
Commands.checkPermissions(user: string, cmd: string): unknown
```

**Source:** [woofwoofwoof/src/commands.ts#L116](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L116)

#### setAuth

```typescript
Commands.setAuth(authFunc: import("/home/wolfy/code/wolfymaster/woofx3/woofwoofwoof/src/commands").AuthorizationFunction): unknown
```

**Source:** [woofwoofwoof/src/commands.ts#L120](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L120)

## Command

**Source:** [woofwoofwoof/src/commands.ts#L4](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L4)

### Properties

| Property | Type | readonly | |
|----------|------|----------|-|
| action | `string` |  | [woofwoofwoof/src/commands.ts#L5](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L5) |
| command | `string` |  | [woofwoofwoof/src/commands.ts#L6](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L6) |
| response | `import("/home/wolfy/code/wolfymaster/woofx3/woofwoofwoof/src/commands").CommandResponse` |  | [woofwoofwoof/src/commands.ts#L7](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L7) |

## ChatWatcherFunction

```typescript
type ChatWatcherFunction = import("/home/wolfy/code/wolfymaster/woofx3/woofwoofwoof/src/commands").ChatWatcherFunction
```

**Source:** [woofwoofwoof/src/commands.ts#L10](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L10)

## CommandResponse

```typescript
type CommandResponse = import("/home/wolfy/code/wolfymaster/woofx3/woofwoofwoof/src/commands").CommandResponse
```

**Source:** [woofwoofwoof/src/commands.ts#L12](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L12)

## AuthorizationResponse

```typescript
type AuthorizationResponse = import("/home/wolfy/code/wolfymaster/woofx3/woofwoofwoof/src/commands").AuthorizationResponse
```

**Source:** [woofwoofwoof/src/commands.ts#L15](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L15)

## AuthorizationFunction

```typescript
type AuthorizationFunction = import("/home/wolfy/code/wolfymaster/woofx3/woofwoofwoof/src/commands").AuthorizationFunction
```

**Source:** [woofwoofwoof/src/commands.ts#L19](https://github.com/wolfymaster/woofx3/blob/feature/december/woofwoofwoof/src/commands.ts#L19)

