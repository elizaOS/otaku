# Otaku AI Agent

A DeFi-focused AI agent built on ElizaOS, featuring a modern React frontend, Coinbase Developer Platform (CDP) wallet integration, and comprehensive DeFi capabilities including swaps, bridging, analytics, and market data.

## Features

- **AI Agent Interface** - Real-time chat with Otaku, a DeFi analyst agent
- **CDP Wallet Integration** - Secure authentication and wallet management via Coinbase Developer Platform
- **Multi-Chain Support** - Interact with Ethereum, Base, Polygon, Arbitrum, and more
- **DeFi Actions** - Token swaps, transfers, bridging, and NFT operations
- **Market Data** - Real-time token prices, trending tokens/collections, and DeFi protocol analytics
- **Web Search** - Web search and crypto news integration
- **Modern UI** - Responsive design with Tailwind CSS, Radix UI components, and smooth animations
- **Real-time Communication** - WebSocket-powered instant messaging via Socket.IO


## Architecture

This is a monorepo workspace project built with:

- **Runtime**: Bun 1.2.21
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: ElizaOS Server (@elizaos/server)
- **Build System**: Turbo
- **Styling**: Tailwind CSS 4.x
- **UI Components**: Radix UI
- **State Management**: Zustand, React Query
- **WebSocket**: Socket.IO Client

### Project Structure

```
├── src/
│   ├── index.ts              # Main entry point (agent & plugin config)
│   ├── character.ts          # Otaku agent character definition
│   ├── frontend/             # React application
│   │   ├── App.tsx           # Main App component with CDP integration
│   │   ├── components/       # React components
│   │   │   ├── chat/         # Chat interface components
│   │   │   ├── dashboard/    # Dashboard components (sidebar, wallet, widgets)
│   │   │   ├── agents/       # Agent management UI
│   │   │   ├── auth/         # Authentication components
│   │   │   └── ui/           # Reusable UI components (Radix UI)
│   │   ├── lib/              # Client libraries
│   │   │   ├── elizaClient.ts      # Type-safe API client
│   │   │   ├── socketManager.ts    # WebSocket manager
│   │   │   └── cdpUser.ts          # CDP user utilities
│   │   ├── hooks/            # React hooks
│   │   ├── contexts/         # React contexts (LoadingPanel, Modal)
│   │   └── types/            # TypeScript types
│   ├── packages/             # Workspace packages
│   │   ├── api-client/       # Type-safe ElizaOS API client (@elizaos/api-client)
│   │   └── server/           # Server package docs (@elizaos/server)
│   └── plugins/              # Custom plugins
│       ├── plugin-cdp/       # Coinbase Developer Platform integration
│       ├── plugin-coingecko/ # CoinGecko API integration
│       ├── plugin-web-search/ # Web search (Tavily, CoinDesk)
│       ├── plugin-defillama/  # DeFiLlama TVL analytics
│       ├── plugin-relay/      # Relay Protocol bridging
│       ├── plugin-etherscan/  # Etherscan transaction checking
│       └── plugin-bootstrap/  # Core ElizaOS bootstrap plugin
├── dist/                     # Build output
├── build.ts                  # Backend build script
├── start-server.ts           # Server startup script
├── vite.config.ts           # Vite configuration
├── tailwind.config.js       # Tailwind CSS config
├── turbo.json               # Turbo monorepo config
└── package.json             # Root dependencies & scripts
```

## Prerequisites

- [Bun](https://bun.sh/) 1.2.21+ installed on your system
- Node.js 18+ (for compatibility)
- Coinbase Developer Platform project ID (for CDP wallet features)

## Setup

### 1. Install Dependencies

This project uses workspace dependencies. Install from the root:

```bash
bun install
```

### 2. Configure Environment

Create a `.env` file in the root directory:

```bash
# Server Configuration
SERVER_PORT=3000
NODE_ENV=development

# Auth (required for login)
JWT_SECRET=your-long-random-jwt-secret

# Database
PGLITE_DATA_DIR=./data
# OR use PostgreSQL:
# POSTGRES_URL=postgresql://user:password@localhost:5432/eliza

# Frontend – CDP (required to enable CDP sign-in UI)
VITE_CDP_PROJECT_ID=your-cdp-project-id

# Backend – CDP SDK (required for wallet features)
# You can also use CDP_API_KEY_ID/CDP_API_KEY_SECRET as aliases
CDP_API_KEY_ID=your-cdp-api-key-id
CDP_API_KEY_SECRET=your-cdp-api-key-secret
CDP_WALLET_SECRET=$(openssl rand -hex 32)

# Onchain data (required for balances/NFT fetch)
ALCHEMY_API_KEY=your-alchemy-key

# AI Provider API Keys (at least one required)
OPENAI_API_KEY=your-openai-key
# OR
OPENROUTER_API_KEY=your-openrouter-key

# Plugins
# Required if web-search plugin is enabled (default)
TAVILY_API_KEY=your-tavily-key
# Optional but recommended for pricing
COINGECKO_API_KEY=your-coingecko-key

# Optional: Admins and server-to-server auth
# ADMIN_EMAILS=admin1@example.com,admin2@example.com
# ELIZA_SERVER_AUTH_TOKEN=some-shared-server-token

# Optional: RPC overrides (defaults are provided)
# BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}
# ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}
# OPTIMISM_RPC_URL=...
# ARBITRUM_RPC_URL=...
# POLYGON_RPC_URL=...
```

### 3. Build and Run

#### Development Mode

```bash
# Build all packages and start server
bun run dev

# OR watch mode (rebuilds on changes)
bun run dev:watch
```

This will:
1. Build all workspace packages (`api-client`, `server`, plugins)
2. Build the React frontend into `dist/frontend`
3. Start the ElizaOS server with the Otaku agent
4. Serve everything on **http://localhost:3000**

#### Production Build

```bash
# Build everything
bun run build

# Start production server
bun run start
```

### Available Scripts

- `bun run dev` - Build and start development server
- `bun run dev:watch` - Watch mode with auto-rebuild
- `bun run build` - Build for production (all packages + frontend)
- `bun run build:all` - Build all workspace packages via Turbo
- `bun run build:backend` - Build backend only
- `bun run build:frontend` - Build frontend only
- `bun run start` - Start production server
- `bun run type-check` - Check TypeScript types

Note: The server serves the built frontend from `dist/frontend`. To see UI changes, rebuild the frontend (`bun run build:frontend`).

## Plugins

### CDP Plugin (plugin-cdp)

Coinbase Developer Platform integration providing wallet and payment functionality.

**Actions:**
- `USER_WALLET_INFO` - View wallet balances, tokens, and NFTs
- `CHECK_TOKEN_BALANCE` - Fast balance check for specific tokens (optimized for transaction validation)
- `USER_WALLET_TOKEN_TRANSFER` - Transfer ERC20 tokens to other addresses
- `USER_WALLET_NFT_TRANSFER` - Transfer NFTs to other addresses
- `USER_WALLET_SWAP` - Swap tokens using DEX aggregators
- `FETCH_WITH_PAYMENT` - Make paid API requests using x402 protocol

**Features:**
- Automatic wallet creation on first login
- Multi-chain support (Ethereum, Base, Polygon, Arbitrum, etc.)
- Automatic transaction signing via CDP
- x402 protocol support for paid API requests

**Example Prompts:**
- "Show my wallet portfolio"
- "Transfer 0.01 ETH to 0x..."
- "Swap 100 USDC for ETH"
- "Transfer NFT #123 from collection 0x..."

### CoinGecko Plugin (plugin-coingecko)

Real-time token prices, market data, and trending information.

**Actions:**
- `GET_TOKEN_PRICE_CHART` - Get historical price data with charts
- `GET_TRENDING_TOKENS` - Get trending tokens by market cap
- `GET_TRENDING_SEARCH` - Get trending search terms
- `GET_TOKEN_METADATA` - Get token information and metadata
- `GET_NFT_COLLECTION_STATS` - Get NFT collection statistics

**Example Prompts:**
- "Get ETH price chart and insights"
- "What's trending on Base?"
- "Show me trending NFT collections"
- "Get Bitcoin price"

### Web Search Plugin (plugin-web-search)

Web search and crypto news aggregation.

**Actions:**
- `WEB_SEARCH` - Search the web using Tavily API
- `CRYPTO_NEWS` - Get latest crypto news from CoinDesk

**Example Prompts:**
- "Latest DeFi news"
- "Search for Ethereum upgrades"
- "Crypto market news today"

### DeFiLlama Plugin (plugin-defillama)

DeFi protocol analytics and TVL (Total Value Locked) data.

**Actions:**
- `GET_PROTOCOL_TVL` - Get TVL data for DeFi protocols

**Example Prompts:**
- "Compare Aave vs Uniswap TVL"
- "Get Uniswap TVL"
- "Compare Eigen vs Morpho"

### Relay Plugin (plugin-relay)

Cross-chain asset bridging via Relay Protocol.

**Actions:**
- `RELAY_BRIDGE` - Bridge assets across chains
- `RELAY_QUOTE` - Get bridge quotes
- `RELAY_STATUS` - Check bridge transaction status

**Example Prompts:**
- "Bridge USDC from Base to Arbitrum"
- "Get bridge quote for 100 USDC"
- "Check bridge status for tx 0x..."

### Etherscan Plugin (plugin-etherscan)

Transaction verification and confirmation checking.

**Actions:**
- `CHECK_TRANSACTION_CONFIRMATION` - Verify transaction confirmations

**Example Prompts:**
- "Check confirmation for tx 0x..."
- "Verify transaction status 0x..."
- "How many confirmations for 0x..."

### Bootstrap Plugin (plugin-bootstrap)

Core ElizaOS plugin providing essential agent capabilities:
- Action execution
- Message evaluation
- State management
- Memory and knowledge providers

### SQL Plugin (@elizaos/plugin-sql)

Database integration for persistent storage of messages, memories, and agent state.

## Agent: Otaku

Otaku is a DeFi-focused AI agent designed to provide:

- **Clear, evidence-based guidance** - Uses on-chain and market data to inform conclusions
- **Portfolio diagnostics** - Analyzes and optimizes DeFi portfolios
- **Risk assessment** - Grounded in TVL, audits, and liquidity depth
- **Cross-chain expertise** - Handles bridging and routing across chains
- **Transaction safety** - Always verifies wallet balance before executing on-chain actions

**Character Traits:**
- Data-first approach with concise recommendations
- Precision over hype
- References concrete metrics
- Natural, conversational style
- Direct and punchy communication

## Frontend Architecture

### Components

- **Chat Interface** (`components/chat/`) - Main chat UI with message history, input, and action tools
- **Dashboard** (`components/dashboard/`) - Sidebar, wallet card, widgets, notifications, account page
- **Agents** (`components/agents/`) - Agent selection and management
- **Auth** (`components/auth/`) - CDP sign-in modal
- **UI** (`components/ui/`) - Reusable Radix UI components

### Key Libraries

- **@tanstack/react-query** - Server state management and caching
- **zustand** - Client state management
- **socket.io-client** - WebSocket real-time communication
- **@coinbase/cdp-react** - CDP React integration
- **recharts** - Chart visualization
- **framer-motion** - Animations
- **lucide-react** - Icons

### State Management

- **React Query** - API data fetching and caching
- **Zustand** - Client-side state (if needed)
- **React Context** - Loading panels, modals
- **CDP Hooks** - Wallet state via `@coinbase/cdp-hooks`

## API Client

The project includes a type-safe API client (`@elizaos/api-client`) for interacting with the ElizaOS server:

```typescript
import { elizaClient } from './lib/elizaClient';

// List agents
const { agents } = await elizaClient.agents.listAgents();

// Get agent details
const agent = await elizaClient.agents.getAgent(agentId);

// Send message
const message = await elizaClient.messaging.postMessage(channelId, 'Hello!');

// Get messages
const messages = await elizaClient.messaging.getMessagesForChannel(channelId);

// Create session
const session = await elizaClient.sessions.createSession({
  agentId: agent.id,
  userId: 'user-123',
});

// Send session message
await elizaClient.sessions.sendMessage(session.sessionId, {
  content: 'Hello, agent!',
});
```

## WebSocket Communication

Real-time communication via Socket.IO:

```typescript
import { socketManager } from './lib/socketManager';

// Connect
socketManager.connect(userId);

// Join channel
socketManager.joinChannel(channelId, serverId);

// Send message
socketManager.sendMessage(channelId, 'Hello!', serverId);

// Listen for messages
socketManager.onMessage((data) => {
  console.log('New message:', data);
});
```

## Customization

### Modifying the Agent

Edit `src/character.ts` to customize Otaku's personality, system prompt, bio, topics, and message examples.

### Customizing the UI

- **Styles**: Edit `src/frontend/index.css` or modify Tailwind classes
- **Components**: Create new components in `src/frontend/components/`
- **Theme**: Update `tailwind.config.js` for colors and design tokens

### Adding Plugins

1. Create plugin in `src/plugins/plugin-name/`
2. Implement actions, services, and providers as needed
3. Add plugin to `src/index.ts` in the `projectAgent.plugins` array
4. Rebuild: `bun run build`

### Adding Features

1. **New API Endpoints**: Use `elizaClient` in your components
2. **Real-time Updates**: Use `socketManager` for WebSocket events
3. **New Routes**: Add routes in `App.tsx`

## Development

### Workspace Packages

This project uses Bun workspaces for:
- `@elizaos/api-client` - Type-safe API client
- `@elizaos/server` - ElizaOS server runtime
- Custom plugins in `src/plugins/*`

### Type Checking

```bash
bun run type-check
```

### Building

```bash
# Build all workspace packages
bun run build:all

# Build specific package
cd src/packages/api-client && bun run build
```

## Troubleshooting

### Port Already in Use

Change the port in `.env`:
```bash
SERVER_PORT=3001
```

### Dependencies Not Found

Make sure you're in the project root and run:
```bash
bun install
```

### CDP Not Working

1. Verify `VITE_CDP_PROJECT_ID` is set (frontend)
2. Set backend keys: `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`
3. Set `ALCHEMY_API_KEY` for onchain data (balances/NFTs)
4. Ensure browser allows popups for CDP sign-in

### Frontend Not Loading

1. Check that `vite.config.ts` exists
2. Run `bun run build:frontend` manually
3. Check browser console for errors

### Agent Not Responding

1. Verify API keys are set (OpenAI or OpenRouter)
2. Ensure `JWT_SECRET` is set (required for auth)
3. Check server logs for errors
4. Ensure agent is running: `GET /api/agents`
5. Verify WebSocket connection is established

## Accessing the App

Once running:
- **UI**: http://localhost:3000
- **API**: http://localhost:3000/api/
- **Health Check**: http://localhost:3000/api/server/ping
- **Health (detailed)**: http://localhost:3000/api/server/health
- **Agents**: http://localhost:3000/api/agents

## Environment Variables Reference

### Required

- `JWT_SECRET` - Secret used to sign JWTs for user auth
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY` - AI provider API key

### Required for CDP features

- `VITE_CDP_PROJECT_ID` - Coinbase Developer Platform project ID (frontend sign-in)
- `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` - CDP API credentials (backend)
- `CDP_WALLET_SECRET` - Random 32-byte hex string for CDP wallet encryption
- `ALCHEMY_API_KEY` - Used to fetch balances, tokens, and NFTs

### Optional

- `SERVER_PORT` - Server port (default: 3000)
- `PGLITE_DATA_DIR` - SQLite data directory (default: `./data`)
- `POSTGRES_URL` - PostgreSQL connection string (overrides SQLite)
- `TAVILY_API_KEY` - Tavily API key (required if web-search plugin is enabled)
- `COINGECKO_API_KEY` - CoinGecko API key (better pricing for portfolio)
- `ADMIN_EMAILS` - Comma-separated admin emails for elevated access
- `ELIZA_SERVER_AUTH_TOKEN` - Server-to-server X-API-KEY
- `NODE_ENV` - Environment (development/production)

## License

MIT

---

Built with [ElizaOS](https://github.com/elizaos/eliza) and [Coinbase Developer Platform](https://docs.cdp.coinbase.com/)
