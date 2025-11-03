# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Otaku is a DeFi-focused AI agent built on ElizaOS with a custom React frontend. It's a monorepo workspace project using Bun, featuring real-time chat via Socket.IO, CDP wallet integration, and comprehensive DeFi capabilities.

**Runtime**: Bun 1.2.21 (required)
**Build System**: Turbo (monorepo task runner)
**Package Manager**: Bun workspaces

## Development Commands

### Building and Running

```bash
# Development: Build all packages and start server
bun run dev

# Watch mode: Auto-rebuild on changes
bun run dev:watch

# Production build: Build everything
bun run build

# Start production server
bun run start

# Build specific parts
bun run build:all        # All workspace packages via Turbo
bun run build:backend    # Backend only (build.ts)
bun run build:frontend   # Frontend only (Vite)

# Type checking
bun run type-check
```

### Testing

Tests exist in workspace packages (`api-client` and `server`), not the root:

```bash
# Run tests in api-client package
cd src/packages/api-client && bun test
cd src/packages/api-client && bun test --watch

# Run tests in server package
cd src/packages/server && bun test
cd src/packages/server && bun test:unit              # Unit tests only
cd src/packages/server && bun test:integration       # Integration tests only
cd src/packages/server && bun test:watch             # Watch mode
cd src/packages/server && bun test:coverage          # With coverage
```

**Note**: Root project does not have its own test suite. All tests live in workspace packages.

## Architecture

### Monorepo Structure

The project uses Bun workspaces with three key areas:

1. **Root** (`src/index.ts`, `src/character.ts`) - Agent configuration and character definition
2. **Workspace Packages** (`src/packages/*`) - Shared libraries
   - `@elizaos/api-client` - Type-safe REST API client
   - `@elizaos/server` - ElizaOS server runtime
3. **Plugins** (`src/plugins/*`) - Feature plugins as workspace packages

### Build Pipeline

1. **Turbo** orchestrates workspace package builds based on dependency graph
2. **Backend** (`build.ts`) - Bun.build bundles `src/index.ts` to `dist/` with external core packages
3. **Frontend** (`vite.config.ts`) - Vite builds React app to `dist/frontend/`
4. **Server** (`start-server.ts`) - Loads built agent from `dist/index.js` and serves frontend from `dist/frontend/`

### Critical Build Details

- Backend build externalizes `@elizaos/*` packages to avoid bundling ElizaOS core
- Server imports the built project module (`dist/index.js`) to extract agents and plugins
- Frontend must be built to `dist/frontend/` for server to serve it
- All workspace packages must build before backend/frontend

### Entry Points

- **Agent Entry**: `src/index.ts` exports `Project` with agents array
- **Server Entry**: `start-server.ts` imports built project and starts `AgentServer`
- **Frontend Entry**: `src/frontend/main.tsx` (Vite entry)

### Agent Architecture

The Otaku agent (`src/character.ts`) is configured with:
- **System prompt** with strict transaction safety protocols
- **Nansen MCP integration** for blockchain analytics via `settings.mcp.servers`
- **Plugin array** registered via `projectAgent.plugins` in `src/index.ts`

**Plugin Registration**: Plugins are NOT in `character.plugins` (empty array). They're added to `projectAgent.plugins` as imported modules, then flattened and passed to `server.startAgents()` in `start-server.ts`.

### Frontend-Backend Communication

**REST API** (`lib/elizaClient.ts`):
- Uses `@elizaos/api-client` for type-safe requests
- Base URL: `window.location.origin` (same-origin)
- API key stored in localStorage

**WebSocket** (`lib/socketManager.ts`):
- Socket.IO client for real-time messaging
- Message types: `ROOM_JOINING`, `SEND_MESSAGE`, `MESSAGE`, `ACK`, `THINKING`, `CONTROL`
- Connects to same origin, emits `message` events with typed payloads
- Listens on `messageBroadcast` for agent responses

**User Isolation**: Both REST and WebSocket use `userId` as `serverId` to create isolated worlds per user.

## Plugin System

### Active Plugins (src/index.ts)

Order matters for initialization:
1. `sqlPlugin` - Database/memory (required first)
2. `bootstrapPlugin` - Core ElizaOS capabilities
3. `openrouterPlugin` / `openaiPlugin` - LLM providers
4. `cdpPlugin` - Coinbase wallet integration
5. `coingeckoPlugin` - Token prices/market data
6. `webSearchPlugin` - Web search (Tavily) + crypto news (CoinDesk)
7. `defiLlamaPlugin` - DeFi protocol TVL analytics
8. `relayPlugin` - Cross-chain bridging
9. `etherscanPlugin` - Transaction verification
10. `mcpPlugin` - MCP server support (Nansen)

### Plugin Development Pattern

Plugins are workspace packages in `src/plugins/plugin-*/`:
- Each has `package.json`, `tsconfig.json`, `build.ts`
- Export actions, services, providers from `src/index.ts`
- Build to `dist/` as ESM modules
- Imported as modules in root `src/index.ts`, not by string name

## Environment Configuration

`.env.sample` is the canonical reference for all environment variables. Required keys:
- `JWT_SECRET` - User authentication
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY` - LLM provider
- `VITE_CDP_PROJECT_ID`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` - Coinbase wallet
- `ALCHEMY_API_KEY` - Blockchain data for CDP plugin

Optional keys in `.env.sample` control plugin features, RPC overrides, x402 payments, and database.

## Agent Character (src/character.ts)

### Transaction Safety Protocol

Otaku has strict rules to prevent unintended transactions:

**Question Detection** (NEVER execute):
- Phrases: "how do I", "can you", "should I", "what if", "how about", "could you"
- Response: Provide guidance, ask "Want me to execute?"

**Direct Commands** (may execute after verification):
- Phrases: "swap X to Y", "bridge Z", "send A to B"
- Flow: Verify balance → show plan → execute (confirm if unusual amounts)

**Transfers/NFTs** (extra caution):
1. Verify recipient, amount, token, network
2. Show clear summary with USD value
3. Ask "Is this exactly what you want me to execute?"
4. Wait for explicit "yes"/"confirm"/"go ahead"

### Pre-flight Checks

Before ANY on-chain action:
- Check `USER_WALLET_INFO` for balances
- Never stage failing transactions
- For gas token swaps, keep buffer for 2+ transactions
- State shortfall + alternatives if insufficient funds

### Tool Usage Discipline

- **Macro/market data** (CME gaps, news): ALWAYS use `WEB_SEARCH` with `time_range="day"/"week"`, `topic="finance"` - never hallucinate
- **Nansen MCP tools**: Primary for market diagnostics (token screeners, flows, PnL, trades, portfolio, counterparties)
- Map 2-3 tool combos for complex queries, pick optimal path
- Cross-verify conflicting data
- Acknowledge gaps honestly vs fabricating

### Cannot Do

- LP staking, liquidity provision, pool deposits - decline immediately and suggest swaps/bridges/analysis

### Style

- Concise, evidence-based, lead with answer
- Natural conversational tone (not procedural/status jargon)
- **ALWAYS** display full 66-character transaction hashes (never truncate)
- Sound like knowledgeable colleague, not status console

## Common Patterns

### Adding a New Plugin

1. Create `src/plugins/plugin-name/` with workspace package structure
2. Add `package.json` with `"name": "plugin-name"`, build scripts
3. Implement actions/services in `src/index.ts`
4. Build plugin: `cd src/plugins/plugin-name && bun run build`
5. Import in root `src/index.ts`: `import myPlugin from './plugins/plugin-name/src/index.ts'`
6. Add to `projectAgent.plugins` array
7. Rebuild backend: `bun run build:backend`

### Modifying Character

Edit `src/character.ts`:
- `system` - Core behavior prompt
- `bio` - Agent description
- `topics` - Areas of expertise
- `messageExamples` - Few-shot examples (critical for behavior)
- `style.all` / `style.chat` - Communication style rules

Rebuild backend after changes: `bun run build:backend`

### Frontend Changes

1. Edit files in `src/frontend/`
2. Rebuild: `bun run build:frontend`
3. Restart server: `bun run start` (server serves from `dist/frontend/`)

**Note**: Server does NOT hot-reload frontend. Must rebuild to see changes.

### WebSocket Debugging

Check `src/frontend/lib/socketManager.ts` for message flow:
- `ROOM_JOINING` (type: 1) - Join channel
- `SEND_MESSAGE` (type: 2) - Send user message
- `MESSAGE` (type: 3) - Receive agent message
- Listen on `messageBroadcast` event, emit on `message` event

## Important Constraints

### Polygon Network Specifics

- Polygon does NOT support native ETH balances
- ETH on Polygon is WETH (wrapped ETH)
- WETH on Polygon CANNOT be unwrapped to native ETH
- Gas token is POL (formerly MATIC)
- If user references ETH on Polygon, clarify it's WETH and adjust plan

### Native Token Swap Protection

- When swapping native gas token (ETH, POL), keep buffer for 2+ transactions
- Flag shortfall if user wants to swap everything
- WETH is NOT a gas token anywhere

### Server Architecture

The server (`@elizaos/server` package) provides:
- REST API with JWT authentication
- Socket.IO WebSocket server
- Database integration (PGlite or PostgreSQL)
- Multi-agent runtime management
- Static file serving for frontend

Custom server start (`start-server.ts`):
1. Creates `AgentServer` instance
2. Initializes with `clientPath: 'dist/frontend'` (custom UI)
3. Imports built project from `dist/index.js`
4. Extracts `agents` and `plugins` arrays
5. Calls `server.startAgents(characters, plugins)`

### API Client Usage

```typescript
import { elizaClient } from './lib/elizaClient';

// Type-safe methods
const { agents } = await elizaClient.agents.listAgents();
const agent = await elizaClient.agents.getAgent(agentId);
const message = await elizaClient.messaging.postMessage(channelId, text);
const messages = await elizaClient.messaging.getMessagesForChannel(channelId);
```

## Troubleshooting

### Build Failures

- Ensure Bun 1.2.21+ installed: `bun --version`
- Clean and rebuild: `rm -rf dist node_modules && bun install && bun run build`
- Check workspace packages built: `cd src/packages/api-client && bun run build`

### Server Won't Start

- Verify `.env` has required keys (JWT_SECRET, OPENAI_API_KEY/OPENROUTER_API_KEY, CDP keys, ALCHEMY_API_KEY)
- Check built project exists: `ls dist/index.js`
- Verify frontend built: `ls dist/frontend/index.html`

### Agent Not Responding

- Check LLM API keys are valid
- Verify agent loaded: `GET http://localhost:3000/api/agents`
- Check WebSocket connection in browser dev tools
- Review server logs for errors (LOG_LEVEL=debug)

### Frontend Not Loading

- Rebuild frontend: `bun run build:frontend`
- Check `dist/frontend/` contains built files
- Verify server serves static files (browser network tab)

### Port Conflicts

Change port in `.env`:
```bash
SERVER_PORT=3001
```

## Key Files Reference

- `src/index.ts` - Agent and plugin registration
- `src/character.ts` - Otaku character definition
- `src/frontend/App.tsx` - Main React app with CDP integration
- `src/frontend/lib/elizaClient.ts` - API client singleton
- `src/frontend/lib/socketManager.ts` - WebSocket manager
- `build.ts` - Backend build script (Bun.build)
- `start-server.ts` - Server startup with custom UI path
- `vite.config.ts` - Frontend build config
- `turbo.json` - Monorepo task orchestration
- `.env.sample` - Canonical environment variable reference
