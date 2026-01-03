# Architecture

## Monorepo Structure

```
otaku/
├── src/
│   ├── index.ts                    # Agent & plugin registration
│   ├── character.ts                # Otaku agent character definition
│   ├── managers/                   # Shared business logic
│   ├── constants/                  # Shared constants
│   ├── packages/                   # Bun workspace packages
│   │   ├── api-client/             # Type-safe REST API client
│   │   └── server/                 # ElizaOS server runtime
│   ├── plugins/                    # Plugin workspace packages
│   │   ├── plugin-bootstrap/       # Core message handling
│   │   ├── plugin-cdp/             # Coinbase wallet
│   │   └── [11 more plugins]
│   └── frontend/                   # React UI (Vite)
├── build.ts                        # Backend build
├── start-server.ts                 # Server startup
└── dist/                           # Build output
    ├── index.js                    # Built agent
    └── frontend/                   # Built React app
```

**Three Key Areas:**
1. **Root** - Agent configuration (`src/index.ts`, `src/character.ts`)
2. **Workspace Packages** - Shared libraries (`src/packages/*`)
3. **Plugins** - Feature plugins (`src/plugins/*`)

## Build Pipeline

**Three-Phase Build:**

### Phase 1: Workspace Packages (Turbo)
- `src/packages/api-client/` → `dist/` (ESM)
- `src/packages/server/` → `dist/` (ESM)
- Orchestrated by dependency graph in `turbo.json`

### Phase 2: Backend Bundle (Bun.build)
- **Entry**: `src/index.ts`
- **Output**: `dist/index.js`
- **Externalizes**: `@elizaos/*`, workspace packages, `dotenv`, `fs`
- **Format**: ESM for runtime compatibility

See: `build.ts`

### Phase 3: Frontend Build (Vite)
- **Entry**: `src/frontend/main.tsx`
- **Output**: `dist/frontend/index.html` + assets
- **Served from**: `clientPath: 'dist/frontend'`

See: `vite.config.ts`

**Critical Details:**
- Backend externalizes `@elizaos/*` to avoid bundling ElizaOS core
- Server imports `dist/index.js` to extract agents and plugins
- All workspace packages must build before backend/frontend

## Entry Points

| Component | File | Exports |
|-----------|------|---------|
| Agent | `src/index.ts` | `projectAgent` with character & plugins |
| Character | `src/character.ts` | Character config object |
| Server | `start-server.ts` | Creates `AgentServer`, loads built agent |
| Frontend | `src/frontend/main.tsx` | React app root |

## Server Architecture

The server (`@elizaos/server` package) provides:
- REST API with JWT authentication
- Socket.IO WebSocket server
- Database integration (PGlite or PostgreSQL)
- Multi-agent runtime management
- Static file serving for frontend

**Startup Flow** (see `start-server.ts`):
1. Creates `AgentServer` instance
2. Initializes with `clientPath: 'dist/frontend'`
3. Imports built project from `dist/index.js`
4. Extracts `agents` and `plugins` arrays
5. Calls `server.startAgents(characters, plugins)`

## Frontend-Backend Communication

### REST API
- **Client**: `src/frontend/lib/elizaClient.ts` (singleton)
- **Package**: `@elizaos/api-client`
- **Base URL**: `window.location.origin` (same-origin)
- **Auth**: JWT token in localStorage, API key optional

**Key Methods**:
- `elizaClient.auth.login()` - User authentication
- `elizaClient.agents.listAgents()` - Get agents
- `elizaClient.messaging.postMessage()` - Send message
- `elizaClient.messaging.getMessagesForChannel()` - Get history

### WebSocket (Socket.IO)
- **Manager**: `src/frontend/lib/socketManager.ts`
- **Message Types**: `ROOM_JOINING(1)`, `SEND_MESSAGE(2)`, `MESSAGE(3)`, `THINKING(5)`
- **Events**: Emit on `message`, listen on `messageBroadcast`

**User Isolation**:
- `userId` = `serverId` → Isolated worlds per user
- `channelId` = room ID → User-specific conversations

## Plugin System

**Registration Order** (see `src/index.ts`):
1. `sqlPlugin` - Database/memory (required first)
2. `bootstrapPlugin` - Multi-step orchestration
3. `openaiPlugin` - LLM provider
4. `cdpPlugin` - Coinbase wallet
5. `coingeckoPlugin` - Token prices
6. `webSearchPlugin` - Web search
7. `defiLlamaPlugin` - DeFi TVL
8. `relayPlugin` - Cross-chain bridging
9. `etherscanPlugin` - TX verification
10. `mcpPlugin` - MCP servers (Nansen)

**Plugin Structure**:
```
plugin-name/
├── src/
│   ├── index.ts           # Plugin export
│   ├── actions/           # Action implementations
│   ├── services/          # Service classes
│   ├── providers/         # Context providers
│   └── types.ts           # TypeScript types
```

Each plugin exports: `actions`, `services`, `providers`

See example: `src/plugins/plugin-cdp/src/index.ts`

## Important Constraints

### Polygon Network
- NO native ETH balances on Polygon
- ETH on Polygon = WETH (wrapped, cannot unwrap)
- Native gas token = POL (formerly MATIC)
- POL only native on Polygon, not on Base/Ethereum/Arbitrum/Optimism

### Native Token Swap Protection
- Keep buffer for 2+ transactions when swapping gas tokens
- ETH native on: Base, Ethereum, Arbitrum, Optimism
- POL native on: Polygon only
- WETH is NOT a gas token anywhere
