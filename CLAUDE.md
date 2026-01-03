# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Otaku is a DeFi-focused AI agent built on ElizaOS with a custom React frontend. It's a monorepo workspace project using Bun, featuring real-time chat via Socket.IO, CDP wallet integration, and comprehensive DeFi capabilities.

**Runtime**: Bun 1.2.21+ (required)
**Build System**: Turbo (monorepo task runner)
**Package Manager**: Bun workspaces

## Quick Start

```bash
# Install dependencies
bun install

# Build everything
bun run build

# Start server
bun run start

# Development mode (build + watch + start)
bun run dev
```

## Key Commands

### Building

```bash
bun run build              # Full build (all packages + backend + frontend)
bun run build:all          # Workspace packages only (Turbo)
bun run build:backend      # Backend only (Bun.build)
bun run build:frontend     # Frontend only (Vite)
```

### Development

```bash
bun run dev                # Build + start
bun run dev:watch          # Build + watch + start
bun run type-check         # TypeScript type checking
```

### Testing

Tests live in workspace packages, not root:

```bash
cd src/packages/api-client && bun test
cd src/packages/server && bun test
cd src/packages/server && bun test:unit
cd src/packages/server && bun test:integration
```

## Documentation

Detailed documentation is organized by topic:

### Architecture & Build System
📖 **[Architecture Guide](docs/architecture.md)**
- Monorepo structure
- Build pipeline (Turbo + Bun + Vite)
- Entry points
- Server architecture
- Frontend-backend communication
- Plugin system overview

### Plugin Actions (Tool Calls)
📖 **[Plugin Actions Guide](docs/plugin-actions.md)**
- How actions work (actions = tool calls)
- Parameter flow and validation
- Multi-step execution system
- Action definition and registration
- Complete examples

### Development Patterns
📖 **[Development Guide](docs/development.md)**
- Adding a new plugin
- Adding actions to existing plugins
- Modifying character behavior
- Frontend changes
- Environment variables
- Testing

### Troubleshooting
📖 **[Troubleshooting Guide](docs/troubleshooting.md)**
- Build failures
- Server won't start
- Agent not responding
- Action not available to LLM
- Parameters not reaching action
- Frontend issues
- Database errors
- Performance problems

### Character Configuration
📖 **[Character Config Guide](docs/character-config.md)**
- Transaction safety protocol
- Network-specific rules
- Tool usage guidelines
- Message examples
- Style rules
- Morpho lending (high risk)

## Project Structure

```
otaku/
├── src/
│   ├── index.ts              # Agent & plugin registration
│   ├── character.ts          # Otaku character definition
│   ├── packages/             # Workspace packages
│   │   ├── api-client/       # Type-safe REST client
│   │   └── server/           # ElizaOS server runtime
│   ├── plugins/              # Plugin directories
│   │   ├── plugin-bootstrap/ # Multi-step orchestration
│   │   ├── plugin-cdp/       # Coinbase wallet
│   │   └── [11 more plugins]
│   └── frontend/             # React UI
├── docs/                     # Documentation
├── build.ts                  # Backend build script
├── start-server.ts           # Server startup
└── dist/                     # Build output
```

## Environment Setup

Copy `.env.sample` to `.env` and configure:

**Required**:
- `JWT_SECRET`
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY`
- `VITE_CDP_PROJECT_ID`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`
- `ALCHEMY_API_KEY`

**Optional**: Plugin API keys, RPC overrides, database config

See: `.env.sample` for complete reference

## Key Concepts

### Plugin Actions = Tool Calls

Actions in ElizaOS work like tool calls in other LLM frameworks:
- LLM selects action and generates parameters as JSON
- Parameters flow through state (`state.data.actionParams`)
- Multi-stage validation (service, required fields, types, business logic)
- Actions chain together in multi-step execution

See: [Plugin Actions Guide](docs/plugin-actions.md)

### Build Pipeline

Three-phase build:
1. **Turbo** - Workspace packages based on dependency graph
2. **Bun.build** - Backend bundle (externalizes `@elizaos/*`)
3. **Vite** - Frontend bundle

See: [Architecture Guide](docs/architecture.md)

### Character Configuration

Agent behavior defined in `src/character.ts`:
- Transaction safety rules (questions vs commands vs transfers)
- Network-specific rules (Polygon ETH = WETH, POL = gas token)
- Tool usage patterns (WEB_SEARCH for macro data, Nansen for analytics)
- Communication style (concise, evidence-based, natural tone)

See: [Character Config Guide](docs/character-config.md)

## Common Tasks

### Add a Plugin
1. Create `src/plugins/plugin-name/` structure
2. Implement actions (see [Plugin Actions Guide](docs/plugin-actions.md))
3. Export plugin from `src/plugins/plugin-name/src/index.ts`
4. Register in `src/index.ts` plugins array
5. Rebuild: `bun run build:backend`

See: [Development Guide](docs/development.md#adding-a-new-plugin)

### Add an Action
1. Create action file in `src/plugins/plugin-name/src/actions/`
2. Export from plugin's `src/index.ts`
3. Rebuild: `bun run build:backend`

See: [Development Guide](docs/development.md#adding-an-action-to-existing-plugin)

### Modify Character
1. Edit `src/character.ts`
2. Rebuild: `bun run build:backend`

See: [Character Config Guide](docs/character-config.md)

### Update Frontend
1. Edit files in `src/frontend/`
2. Rebuild: `bun run build:frontend`
3. Restart: `bun run start`

See: [Development Guide](docs/development.md#frontend-changes)

## Troubleshooting Quick Reference

**Build fails**: `rm -rf dist node_modules && bun install && bun run build`
**Server won't start**: Check `.env` has required keys, verify `dist/index.js` exists
**Agent not responding**: Check LLM API key, WebSocket connection, server logs
**Action not available**: Check `validate` returns true, plugin registered, rebuild backend
**Frontend not updating**: Rebuild frontend, restart server (no hot-reload)

See: [Troubleshooting Guide](docs/troubleshooting.md)

## Important Constraints

### Polygon Network
- NO native ETH (ETH = WETH, cannot unwrap)
- Native gas token = POL
- POL only native on Polygon, not other chains

### Gas Token Swaps
- Keep buffer for 2+ transactions
- ETH native on: Base, Ethereum, Arbitrum, Optimism
- POL native on: Polygon
- WETH is NOT a gas token anywhere

See: [Character Config Guide](docs/character-config.md#network-specific-rules)

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Agent & plugin registration |
| `src/character.ts` | Character definition |
| `build.ts` | Backend build script |
| `start-server.ts` | Server startup |
| `vite.config.ts` | Frontend build config |
| `.env.sample` | Environment variables reference |

## Further Reading

- 📖 [Architecture Guide](docs/architecture.md) - System design & build pipeline
- 📖 [Plugin Actions Guide](docs/plugin-actions.md) - How actions work
- 📖 [Development Guide](docs/development.md) - Common development tasks
- 📖 [Troubleshooting Guide](docs/troubleshooting.md) - Debugging & fixes
- 📖 [Character Config Guide](docs/character-config.md) - Agent behavior
