# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Otaku is a DeFi-focused AI agent built on ElizaOS, featuring a modern React frontend, Coinbase Developer Platform (CDP) wallet integration, and comprehensive DeFi capabilities. The project uses Bun as the runtime and package manager, with a monorepo workspace structure.

**Tech Stack:**
- Runtime: Bun 1.2.21+
- Frontend: React 18 + TypeScript + Vite
- Backend: ElizaOS Server (@elizaos/server)
- Build System: Turbo (monorepo orchestration)
- Styling: Tailwind CSS 4.x
- UI: Radix UI components
- WebSocket: Socket.IO for real-time messaging

## Common Commands

### Development

```bash
# Development - Build all packages and start server
bun run dev

# Watch mode - Rebuilds on changes
bun run dev:watch

# Start server only (requires prior build)
bun run start
```

### Building

```bash
# Build everything (all packages + frontend + backend)
bun run build

# Build all workspace packages only
bun run build:all

# Build backend only
bun run build:backend

# Build frontend only (React app)
bun run build:frontend

# Type checking
bun run type-check
```

### Testing Individual Components

```bash
# Build a specific workspace package
cd src/packages/api-client && bun run build
cd src/plugins/plugin-cdp && bun run build

# Run frontend dev server independently (if needed)
cd src/frontend && vite dev
```

## Architecture

### Monorepo Structure

The project uses Bun workspaces with Turbo for build orchestration:

- **Workspace packages** (`src/packages/*`):
  - `@elizaos/api-client` - Type-safe API client for ElizaOS server
  - `@elizaos/server` - ElizaOS server runtime documentation

- **Plugins** (`src/plugins/*`):
  - `plugin-bootstrap` - Core ElizaOS behaviors and providers
  - `plugin-cdp` - Coinbase Developer Platform integration
  - `plugin-coingecko` - Token pricing and market data
  - `plugin-web-search` - Web search and crypto news (Tavily, CoinDesk)
  - `plugin-defillama` - DeFi protocol TVL analytics
  - `plugin-relay` - Cross-chain bridging via Relay Protocol
  - `plugin-etherscan` - Transaction verification

### Build Pipeline

1. **Turbo** orchestrates workspace package builds (`bun run build:all`)
2. **Backend build** (`build.ts`):
   - Bundles `src/index.ts` to `dist/` using Bun.build
   - Generates TypeScript declarations with `tsc --emitDeclarationOnly`
   - Externalizes ElizaOS core packages to avoid bundling issues
3. **Frontend build** (`vite build`):
   - Builds React app from `src/frontend/` to `dist/frontend/`
   - Vite config loads all env vars (not just VITE_ prefixed) and exposes them to `import.meta.env`
4. **Server startup** (`start-server.ts`):
   - Loads built project from `dist/index.js`
   - Serves frontend from `dist/frontend/`
   - Starts ElizaOS server with all plugins and agents

### Agent Configuration

**Entry point:** `src/index.ts`
- Imports character definition from `src/character.ts`
- Registers plugins in `projectAgent.plugins` array
- Exports `Project` object consumed by ElizaOS server

**Character:** `src/character.ts` (Otaku)
- DeFi analyst personality with evidence-based guidance
- System prompt emphasizes balance verification before on-chain actions
- Style guide: concise, data-driven, no procedural language

### Plugin Architecture

Each plugin in `src/plugins/plugin-*/` follows ElizaOS plugin structure:

```typescript
export const myPlugin: Plugin = {
  name: "plugin-name",
  description: "...",
  actions: [],      // AI-invocable actions
  providers: [],    // Context providers (e.g., wallet state)
  services: [],     // Runtime services
  evaluators: [],   // Message evaluators
};
```

**Key Plugin Details:**

- **CDP Plugin**: Provides wallet management, token/NFT transfers, swaps, and x402 paid API requests. Uses `CdpService` to manage CDP SDK client. Actions always verify wallet balance before executing on-chain transactions.

- **Bootstrap Plugin**: Core ElizaOS functionality - action execution, message evaluation, state management, memory providers. Required for agent operation.

### Frontend Architecture

**Location:** `src/frontend/`

**Key Libraries:**
- `@elizaos/api-client` - Type-safe API client (see `lib/elizaClient.ts`)
- `@tanstack/react-query` - Server state management
- `zustand` - Client state management
- `@coinbase/cdp-react`, `@coinbase/cdp-hooks` - CDP wallet integration
- `socket.io-client` - Real-time messaging (see `lib/socketManager.ts`)
- `recharts` - Chart visualization
- `framer-motion` - Animations

**Component Structure:**
- `components/chat/` - Chat interface with message history and input
- `components/dashboard/` - Sidebar, wallet card, widgets
- `components/agents/` - Agent selection and management
- `components/auth/` - CDP sign-in modal
- `components/ui/` - Reusable Radix UI primitives

**State Management:**
- React Query for API data fetching and caching
- CDP hooks (`useCdp`, `useUser`, `useWalletClient`) for wallet state
- React Context for modals and loading panels

### API Communication

**REST API:** Use `elizaClient` from `lib/elizaClient.ts`
```typescript
import { elizaClient } from './lib/elizaClient';

// List agents
const { agents } = await elizaClient.agents.listAgents();

// Send message
const message = await elizaClient.messaging.postMessage(channelId, 'Hello!');

// Create session
const session = await elizaClient.sessions.createSession({ agentId, userId });
```

**WebSocket:** Use `socketManager` from `lib/socketManager.ts`
```typescript
import { socketManager } from './lib/socketManager';

// Connect and join channel
socketManager.connect(userId);
socketManager.joinChannel(channelId, serverId);

// Send and receive messages
socketManager.sendMessage(channelId, 'Hello!', serverId);
socketManager.onMessage((data) => console.log('New message:', data));
```

## Environment Configuration

**Required Variables:**
- `JWT_SECRET` - JWT signing secret for user auth
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY` - AI provider

**CDP Features (required for wallet functionality):**
- `VITE_CDP_PROJECT_ID` - Frontend CDP sign-in
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` - Backend CDP SDK
- `CDP_WALLET_SECRET` - Random 32-byte hex for wallet encryption
- `ALCHEMY_API_KEY` - Fetches balances, tokens, NFTs

**Optional:**
- `SERVER_PORT` - Default: 3000
- `PGLITE_DATA_DIR` - SQLite data dir (default: `./data`)
- `POSTGRES_URL` - PostgreSQL connection (overrides SQLite)
- `TAVILY_API_KEY` - Required if web-search plugin enabled
- `COINGECKO_API_KEY` - Better token pricing
- `X402_PUBLIC_URL` or `PUBLIC_URL` - Public URL for x402 payment resource (required in production if behind proxy/CDN)

## Development Workflow

### Adding a New Plugin

1. Create plugin directory: `src/plugins/plugin-name/`
2. Implement plugin structure:
   ```typescript
   // src/plugins/plugin-name/index.ts
   import type { Plugin } from "@elizaos/core";

   export const myPlugin: Plugin = {
     name: "my-plugin",
     description: "...",
     actions: [],
     providers: [],
     services: [],
   };

   export default myPlugin;
   ```
3. Add to workspace: Ensure `package.json` includes `"workspaces": ["src/plugins/*"]`
4. Register in `src/index.ts`:
   ```typescript
   import myPlugin from './plugins/plugin-name/index.ts';

   export const projectAgent: ProjectAgent = {
     plugins: [
       // ... existing plugins,
       myPlugin,
     ],
   };
   ```
5. Rebuild: `bun run build`

### Modifying the Agent Character

Edit `src/character.ts` to customize:
- `system` - System prompt and behavior guidelines
- `bio` - Agent capabilities and expertise
- `topics` - Conversation topics
- `messageExamples` - Example interactions
- `style.all` and `style.chat` - Communication style rules

**Critical Style Rule:** Agent must verify wallet balance before any on-chain action (swaps, transfers, bridges).

### Frontend Changes

1. Make changes in `src/frontend/`
2. Rebuild frontend: `bun run build:frontend`
3. Restart server: `bun run start` (server serves built frontend from `dist/frontend/`)

For rapid frontend iteration, you can run Vite dev server independently:
```bash
cd src/frontend && vite dev
```

### Debugging

**Check server health:**
```bash
curl http://localhost:3000/api/server/health
```

**List agents:**
```bash
curl http://localhost:3000/api/agents
```

**View logs:**
- Server logs print to console when running `bun run dev` or `bun run start`
- Frontend logs appear in browser console

## Key Technical Details

### TypeScript Configuration

- **Path alias:** `@/*` maps to `src/frontend/*`
- **Module resolution:** `bundler` (Bun-compatible)
- **Target:** ES2022
- **Declaration generation:** Enabled for workspace packages

### Build Externals

The backend build (`build.ts`) externalizes these packages to prevent bundling issues:
- `@elizaos/core`, `@elizaos/plugin-*`, `@elizaos/server`, `@elizaos/cli`
- Node.js built-ins (`node:*`, `fs`, `path`, etc.)
- Core dependencies (`dotenv`, `zod`)

If adding new ElizaOS dependencies, add them to the `external` array in `build.ts`.

### Vite Environment Variables

Unlike standard Vite, this project exposes **all** env vars (not just `VITE_` prefixed) to `import.meta.env`. This is configured in `vite.config.ts` via the `define` option.

### x402 Payment Protocol

Otaku supports paid API access via x402 protocol on Base network:
- Endpoint: `POST /api/messaging/jobs`
- Price: $0.015 USDC per request
- Payment: Automatic via `x402-fetch` library
- See `x402-otaku-readme.md` for full integration guide

**Configuration:**
- `X402_RECEIVING_WALLET` - Wallet address to receive payments (required)
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` - Required for mainnet (automatically used by Coinbase facilitator)
- `X402_FACILITATOR_URL` - Custom facilitator URL (optional, defaults to Coinbase facilitator for mainnet. Set to `https://x402.org/facilitator` for testnet)
- `X402_PUBLIC_URL` or `PUBLIC_URL` - Public URL for payment resource (highly recommended in production)
  - **If not set:** Falls back to checking `NODE_ENV`:
    - `NODE_ENV=production` → `https://otaku.so/api/messaging/jobs`
    - Otherwise → `http://localhost:${SERVER_PORT}/api/messaging/jobs`
  - **Important:** Must match the actual URL clients use to access the API
  - If your server is behind a proxy/CDN, **you must set this explicitly** or payments will fail validation

The CDP plugin includes `FETCH_WITH_PAYMENT` action for making x402 requests from within the agent.

## Common Issues

**"Dependencies not found":**
- Ensure you're in project root
- Run `bun install`

**"Frontend not loading":**
- Check that `dist/frontend/` exists
- Run `bun run build:frontend`
- Check browser console for errors

**"Agent not responding":**
- Verify API keys (OpenAI or OpenRouter)
- Ensure `JWT_SECRET` is set
- Check server logs for errors

**"CDP wallet features not working":**
- Verify `VITE_CDP_PROJECT_ID` (frontend sign-in)
- Set backend keys: `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`
- Set `ALCHEMY_API_KEY` for balance/NFT fetching
- Check browser allows popups for CDP sign-in

**"Port already in use":**
- Change `SERVER_PORT` in `.env`

**"x402 payment not working":**
- Ensure `X402_RECEIVING_WALLET` is set to your wallet address
- In production, set `X402_PUBLIC_URL` to match your actual domain (e.g., `https://otaku.so`)
- The resource URL in 402 responses must match the URL clients use to make requests
- Verify `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are set for mainnet facilitator
- Check server logs for x402 middleware initialization messages

## API Endpoints

- **UI:** `http://localhost:3000`
- **Health:** `GET /api/server/health`
- **Agents:** `GET /api/agents`
- **Ping:** `GET /api/server/ping`
- **Messages:** `POST /api/messaging/:channelId/messages`
- **Sessions:** `POST /api/sessions`, `POST /api/sessions/:sessionId/messages`
