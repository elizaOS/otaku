# Development Guide

## Adding a New Plugin

### 1. Create Plugin Directory

```bash
mkdir -p src/plugins/plugin-name/src/actions
mkdir -p src/plugins/plugin-name/src/services
```

### 2. Add Dependencies (if needed)

If your plugin requires external libraries, install them in the root:

```bash
bun add some-library
```

Plugins do NOT have their own `package.json` or `node_modules`. All dependencies are managed at the root level.

### 3. Create Plugin Export

File: `src/plugins/plugin-name/src/index.ts`

Must export: `Plugin` object with `{ name, description, actions, services, providers }`

**See example**: `src/plugins/plugin-cdp/src/index.ts`

### 4. Implement Actions

File: `src/plugins/plugin-name/src/actions/my-action.ts`

Must export: `Action` object with `{ name, description, parameters, validate, handler }`

**See guide**: `docs/plugin-actions.md`

**See examples**:
- `src/plugins/plugin-cdp/src/actions/cdp-wallet-swap.ts`
- `src/plugins/plugin-web-search/src/actions/webSearch.ts`

### 5. Register in Root

File: `src/index.ts`

```typescript
import myPlugin from './plugins/plugin-name/src/index.ts';

export const projectAgent: ProjectAgent = {
  character,
  plugins: [
    sqlPlugin,
    bootstrapPlugin,
    openaiPlugin,
    myPlugin,  // Add here
    // ... more plugins
  ],
};
```

**Order matters**: Services must be registered before actions that use them.

### 6. Rebuild Backend

```bash
bun run build:backend
```

## Adding an Action to Existing Plugin

### 1. Create Action File

File: `src/plugins/plugin-name/src/actions/my-action.ts`

**Pattern**:
- Import `Action` from `@elizaos/core`
- Define params interface
- Export action object with name, description, parameters, validate, handler
- Handler retrieves params from `state.data.actionParams`
- Handler validates params and returns `ActionResult`

**See examples**: `src/plugins/plugin-cdp/src/actions/`

### 2. Export from Plugin

File: `src/plugins/plugin-name/src/index.ts`

Add to `actions` array:
```typescript
actions: [existingAction1, existingAction2, myAction]
```

### 3. Rebuild

```bash
bun run build:backend
```

## Action Handler Pattern

**Retrieve Parameters**:
```typescript
const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
const params = composedState?.data?.actionParams || {};
```

**Validate Required Params**:
```typescript
if (!params.requiredParam) {
  return {
    text: "Missing required parameter 'requiredParam'",
    success: false,
    error: "missing_required_parameter"
  };
}
```

**Extract with Defaults**:
```typescript
const param1 = params.param1?.trim();
const param2 = params.param2 || "default_value";
```

**Return Result**:
```typescript
return {
  text: "Action completed successfully",
  success: true,
  values: { outputData }
};
```

## Modifying Character

File: `src/character.ts`

**Key Sections**:
- `system` - Core behavior prompt
- `bio` - Agent description
- `topics` - Areas of expertise
- `messageExamples` - Few-shot examples (critical for behavior)
- `style.all` / `style.chat` - Communication style rules
- `settings.mcp.servers` - MCP server configuration

**After editing**: `bun run build:backend`

**See guide**: `docs/character-config.md`

## Frontend Changes

### Editing UI

Files: `src/frontend/`

**Key Files**:
- `App.tsx` - Main app with routing
- `components/` - React components
- `contexts/` - React contexts
- `lib/elizaClient.ts` - API client
- `lib/socketManager.ts` - WebSocket manager

### Rebuild Frontend

```bash
bun run build:frontend
```

**Note**: Server does NOT hot-reload. Must rebuild and restart.

### Restart Server

```bash
bun run start
```

Server serves frontend from `dist/frontend/`

## WebSocket Message Flow

**Send Message** (type: 2):
```typescript
socketManager.sendMessage(channelId, text, serverId, metadata);
```

**Receive Message** (type: 3):
```typescript
socketManager.onMessage((data) => {
  if (data.type === SOCKET_MESSAGE_TYPE.MESSAGE) {
    // Handle agent response
  }
});
```

**Join Channel** (type: 1):
```typescript
socketManager.joinChannel(channelId, serverId, metadata);
```

**See implementation**: `src/frontend/lib/socketManager.ts`

## Testing

Tests live in workspace packages, not root.

### API Client Tests

```bash
cd src/packages/api-client && bun test
cd src/packages/api-client && bun test --watch
```

### Server Tests

```bash
cd src/packages/server && bun test
cd src/packages/server && bun test:unit              # Unit only
cd src/packages/server && bun test:integration       # Integration only
cd src/packages/server && bun test:watch             # Watch mode
cd src/packages/server && bun test:coverage          # With coverage
```

## Build Commands

```bash
# Full build (all packages + backend + frontend)
bun run build

# Workspace packages only (Turbo)
bun run build:all

# Backend only (Bun.build)
bun run build:backend

# Frontend only (Vite)
bun run build:frontend

# Development mode (build + watch + start)
bun run dev
bun run dev:watch

# Type checking
bun run type-check
```

## Environment Variables

**Reference**: `.env.sample` (canonical source)

**Required**:
- `JWT_SECRET`
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY`
- `VITE_CDP_PROJECT_ID`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`
- `ALCHEMY_API_KEY`

**Optional**:
- Plugin API keys (Tavily, CoinGecko, Nansen, etc.)
- RPC overrides
- Database config
- x402 payment config

## Common Mistakes

**Action not available to LLM**:
- Check `validate` function returns `true`
- Verify plugin registered in `src/index.ts`
- Check plugin order (services before actions)
- Rebuild backend

**Parameters not reaching action**:
- Check LLM generated `<parameters>` in XML
- Verify param names match schema (case-sensitive)
- Check state contains `actionParams`
- Add logging: `console.log(params)` in handler

**Frontend not updating**:
- Rebuild frontend: `bun run build:frontend`
- Restart server: `bun run start`
- Server doesn't hot-reload

**Build failures**:
- Clean: `rm -rf dist node_modules`
- Reinstall: `bun install`
- Rebuild: `bun run build`

See more: `docs/troubleshooting.md`
