# Plugin Context Matcher

Context-aware plugin activation to reduce LLM context size.

## Problem

With many plugins installed, all actions are shown to the LLM in every request, leading to:
- Large context windows
- Slower response times
- Higher costs
- Irrelevant actions cluttering the prompt

## Solution

**Plugin-level keyword matching** that filters actions based on recent conversation context. Each action's `validate` function checks if the plugin is relevant before checking service availability.

## Architecture

```
┌─────────────────────────────────────────────┐
│ 1. User message: "swap 10 ETH to USDC"     │
└────────────┬────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────┐
│ 2. For each action, validate() runs:        │
│    - Check plugin context matcher (fast)    │
│    - If irrelevant → return false           │
│    - If relevant → check service            │
└────────────┬────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────┐
│ 3. Only relevant actions shown to LLM       │
│    ✅ CDP actions (has "swap", "ETH")      │
│    ✅ Web search (always active)           │
│    ❌ Polymarket actions (no keywords)     │
│    ❌ Morpho actions (no keywords)         │
└─────────────────────────────────────────────┘
```

## Implementation

### 1. Core Utility (`src/utils/plugin-context-matcher.ts`)

Reusable matcher that checks recent messages against keyword patterns:

```typescript
import { matchesPluginContext, type PluginKeywordPatterns } from "../../utils/plugin-context-matcher";

const patterns: PluginKeywordPatterns = {
  keywords: ["swap", "trade", "wallet"],
  regexPatterns: [/send.*eth/i]
};

// Checks last 5 messages (default) for keywords
const isRelevant = matchesPluginContext(state, patterns);
```

### 2. Per-Plugin Matcher (`src/plugins/plugin-<name>/matcher.ts`)

Each plugin defines its activation patterns:

```typescript
// src/plugins/plugin-cdp/matcher.ts
import type { State } from "@elizaos/core";
import { matchesPluginContext, type PluginKeywordPatterns } from "../../utils/plugin-context-matcher";

export const cdpKeywordPatterns: PluginKeywordPatterns = {
  keywords: [
    "wallet", "balance", "address",
    "send", "transfer", "pay",
    "swap", "trade", "exchange",
    "token", "eth", "usdc", "dai",
  ],
  regexPatterns: [
    /send.*(?:eth|usdc|dai|token)/i,
    /swap.*(?:eth|usdc|dai|token)/i,
  ],
};

export function shouldCdpPluginBeActive(state?: State): boolean {
  if (!state) return true; // Fallback if no state
  return matchesPluginContext(state, cdpKeywordPatterns);
}
```

### 3. Action Validate Updates

Each action calls the plugin matcher first:

```typescript
// BEFORE
validate: async (_runtime: IAgentRuntime, message: Memory) => {
  const service = _runtime.getService(ServiceType) as Service;
  if (!service) return false;
  return true;
}

// AFTER
import { shouldCdpPluginBeActive } from "../matcher";

validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
  // Check plugin context first
  if (!shouldCdpPluginBeActive(state)) {
    return false;
  }

  // Then check service
  const service = _runtime.getService(ServiceType) as Service;
  if (!service) return false;
  return true;
}
```

## Status

### ✅ All Plugins Implemented

The plugin context matcher is fully implemented across all plugins.

**Core Infrastructure:**
- ✅ Core utility (`src/utils/plugin-context-matcher.ts`)

**CDP Plugin** (9/9 actions via `validateCdpService` helper):
- ✅ `cdp-check-tx-confirmation.ts`
- ✅ `cdp-resolve-ens.ts`
- ✅ `cdp-tx-explorer-link.ts`
- ✅ `cdp-wallet-check-balance.ts`
- ✅ `cdp-wallet-fetch-with-payment.ts`
- ✅ `cdp-wallet-info.ts`
- ✅ `cdp-wallet-nft-transfer.ts`
- ✅ `cdp-wallet-swap.ts`
- ✅ `cdp-wallet-token-transfer.ts`

**Other Plugins** (all have matchers):
- ✅ Biconomy (`src/plugins/plugin-biconomy/src/matcher.ts`)
- ✅ Polymarket (`src/plugins/plugin-polymarket-discovery/matcher.ts`)
- ✅ Morpho (`src/plugins/plugin-morpho/matcher.ts`)
- ✅ Relay (`src/plugins/plugin-relay/matcher.ts`)
- ✅ CoinGecko (`src/plugins/plugin-coingecko/matcher.ts`)
- ✅ DefiLlama (`src/plugins/plugin-defillama/matcher.ts`)
- ✅ Etherscan (`src/plugins/plugin-etherscan/matcher.ts`)
- ✅ Clanker (`src/plugins/plugin-clanker/matcher.ts`)

**Always-Active Plugins** (skip matcher by design):
- Bootstrap (orchestration - always needed)
- Web Search (general utility - always needed)

## Implementation Pattern

Most plugins use a helper function pattern for cleaner code:

### Option 1: Action Helper (Recommended)

```typescript
// src/plugins/plugin-cdp/utils/actionHelpers.ts
import { shouldCdpPluginBeInContext } from "../matcher";

export function validateCdpService(
  runtime: IAgentRuntime,
  actionName: string,
  state?: State,
  message?: Memory
): boolean {
  // Check plugin context first
  if (!shouldCdpPluginBeInContext(state, message)) {
    return false;
  }
  // Then check service availability
  const service = runtime.getService(CdpService.serviceType);
  return !!service;
}

// In action file:
validate: async (runtime, message, state) => {
  return validateCdpService(runtime, 'ACTION_NAME', state, message);
}
```

### Option 2: Direct Import

```typescript
import { shouldCdpPluginBeActive } from "../matcher";

validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
  // Check plugin context first
  if (!shouldCdpPluginBeActive(state)) {
    return false;
  }
  // Then check service
  const service = _runtime.getService(ServiceType);
  return !!service;
}
```

## How to Apply to New Plugins

1. **Create `matcher.ts`** in plugin directory:
   ```typescript
   import type { State } from "@elizaos/core";
   import { matchesPluginContext, type PluginKeywordPatterns } from "../../utils/plugin-context-matcher";

   export const pluginNameKeywordPatterns: PluginKeywordPatterns = {
     keywords: ["keyword1", "keyword2"],
     regexPatterns: [/pattern/i],
   };

   export function shouldPluginNameBeActive(state?: State): boolean {
     if (!state) return true;
     return matchesPluginContext(state, pluginNameKeywordPatterns);
   }
   ```

2. **Update each action** as shown above

3. **Export from plugin index** (optional):
   ```typescript
   export { shouldPluginNameBeActive } from "./matcher";
   ```

## Testing

To verify context reduction:

1. **Before**: Count actions shown to LLM in a non-wallet conversation
2. **After**: Same conversation should show fewer actions
3. **Check logs**: Actions returning false from validate won't appear

Example test conversation:
```
User: "What's the weather like?"
Expected: CDP actions NOT shown (no wallet keywords)

User: "Check my USDC balance"
Expected: CDP actions shown (has "balance", "USDC")
```

## Benefits

- **Reduced context**: Only show relevant actions per conversation
- **Faster responses**: Smaller prompts = faster LLM processing
- **Lower costs**: Less tokens per request
- **Better accuracy**: Fewer irrelevant options = better tool selection
- **Scalable**: Can add unlimited plugins without linear context growth

## Tradeoffs

- **Keyword maintenance**: Must update patterns when adding related actions
- **False negatives**: Poorly chosen keywords might hide relevant actions
- **Initial setup**: Requires one-time pattern definition per plugin

## Future Improvements

- Semantic similarity matching (embeddings) instead of keywords
- Adaptive patterns based on usage analytics
- Per-action override for high-priority actions
- Configuration UI for keyword patterns
