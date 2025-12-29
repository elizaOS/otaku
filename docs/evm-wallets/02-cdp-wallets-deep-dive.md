# CDP Wallets Deep Dive: Server vs Embedded

> Complete guide to Coinbase Developer Platform wallet products

---

## Overview

CDP offers two wallet products built on the same TEE infrastructure but designed for different use cases:

```
┌─────────────────────────────────────────────────────────────┐
│                    CDP Wallet Products                       │
├──────────────────────────┬──────────────────────────────────┤
│   Server Wallets         │   Embedded Wallets               │
│   Developer-controlled   │   User-controlled                │
│   Backend/Agent use      │   Consumer app use               │
└──────────────────────────┴──────────────────────────────────┘
```

---

## Architecture: Shared Foundation

Both products use **AWS Nitro Enclaves** (TEE):

```
┌─────────────────────────────────────────────────────────────┐
│              AWS Nitro Enclave (TEE)                         │
├─────────────────────────────────────────────────────────────┤
│  • No persistent storage (memory only)                       │
│  • No interactive access (no SSH)                            │
│  • No external networking (VSOCK only)                       │
│  • Keys encrypted at rest                                    │
│  • Unencrypted keys NEVER leave TEE                          │
└─────────────────────────────────────────────────────────────┘
```

### Key Generation & Security

1. Keys generated **inside** TEE
2. Encrypted with developer's Wallet Secret
3. Stored encrypted in CDP database
4. Only decrypted inside TEE for signing
5. **Never exposed** - not even to Coinbase

---

## Server Wallets

### Control Model

```
Your Backend
     │
     ├── API Key + Wallet Secret
     │
     ▼
┌─────────────────────────────────────────┐
│  CDP API                                 │
│  - createAccount()                       │
│  - sendTransaction()                     │
│  - sendUserOperation()                   │
└─────────────────────────────────────────┘
     │
     ▼
  Signed automatically
  (no user interaction)
```

### Authentication

```bash
# Three credentials required
export CDP_API_KEY_ID="..."
export CDP_API_KEY_SECRET="..."
export CDP_WALLET_SECRET="..."
```

### Account Types

| Type | When to Use | Gas Sponsorship |
|------|-------------|-----------------|
| **EOA** | Standard operations, lower gas | ❌ No |
| **Smart Account** | Agents, automation, sponsored gas | ✅ Yes |

### Code Example

```typescript
import { CdpClient } from "@coinbase/cdp-sdk"

const cdp = new CdpClient()

// EOA - traditional account
const eoaAccount = await cdp.evm.createAccount()

// Smart Account - for gas sponsorship
const owner = await cdp.evm.getOrCreateAccount({ name: "Owner" })
const smartAccount = await cdp.evm.getOrCreateSmartAccount({
  name: "MyAgent",
  owner
})

// Send with gas sponsorship
const { userOpHash } = await cdp.evm.sendUserOperation({
  smartAccount,
  network: "base",
  calls: [{
    to: "0x...",
    value: parseEther("0.1"),
    data: "0x",
  }],
  paymasterUrl: PAYMASTER_URL, // Optional on Base Sepolia
})
```

### Use Cases

| Use Case | Why Server Wallets |
|----------|-------------------|
| AI Agents | No user confirmation needed |
| Automated Trading | Sub-200ms signing, 225+ TPS on Solana |
| Treasury Management | Policy engine controls |
| Backend Operations | Programmatic at scale |
| AgentKit Integration | Built for autonomous agents |

### Policy Engine

```typescript
// Enforce rules at signing layer (inside TEE)
{
  "scope": "account",
  "rules": [
    {
      "operation": "signEvmTransaction",
      "action": "accept",
      "criteria": {
        "type": "evmAddress",
        "operator": "in",
        "values": ["0xAllowedContract..."]
      }
    },
    {
      "operation": "signEvmTransaction",
      "action": "reject",
      "criteria": {
        "type": "ethValue",
        "operator": ">",
        "values": ["1000000000000000000"] // 1 ETH max
      }
    }
  ]
}
```

**Available Policies:**
- Recipient allowlist/denylist
- Transfer amount limits (min/max)
- USD spend limits
- Contract method restrictions
- Call data validation
- Message signing controls

---

## Embedded Wallets

### Control Model

```
User Device
     │
     ├── Email/SMS/OAuth authentication
     │
     ▼
┌─────────────────────────────────────────┐
│  CDP Session                             │
│  - User authenticated once               │
│  - Wallet created automatically          │
│  - Transactions sign without popups      │
└─────────────────────────────────────────┘
     │
     ▼
  User owns wallet
  (self-custody in TEE)
```

### Authentication Options

| Method | UX | Security |
|--------|-----|----------|
| Email + OTP | Familiar | SMS-level |
| SMS + OTP | Familiar | SMS-level |
| OAuth (Google, Apple) | One-click | OAuth-level |
| Passkeys | Biometric | Highest |

### Account Types

```typescript
const cdpConfig = {
  projectId: "your-project-id",
  ethereum: {
    createOnLogin: "eoa"    // or "smart"
  }
}
```

| Type | Features |
|------|----------|
| **EOA** | Simple, lower gas, user needs ETH |
| **Smart Account** | Gas sponsorship, batch ops, session keys |

### React Integration

```typescript
import { CDPProvider } from "@coinbase/cdp-react"
import { AuthButton, SendEvmTransactionButton } from "@coinbase/cdp-react"
import { useEvmAddress, useSendEvmTransaction } from "@coinbase/cdp-hooks"

function App() {
  return (
    <CDPProvider config={cdpConfig}>
      {/* User signs in - wallet created automatically */}
      <AuthButton />

      {/* Send transaction - no popup */}
      <SendEvmTransactionButton
        to="0x..."
        value="0.01"
        onSuccess={(hash) => console.log(hash)}
      />
    </CDPProvider>
  )
}
```

### Wagmi Integration

```typescript
import { createCDPEmbeddedWalletConnector } from "@coinbase/cdp-wagmi"
import { useSendTransaction } from "wagmi"

const connector = createCDPEmbeddedWalletConnector({
  cdpConfig: {
    projectId: "your-project-id",
    ethereum: { createOnLogin: "smart" }
  }
})

// Use standard wagmi hooks
function SendTx() {
  const { sendTransaction } = useSendTransaction()

  return (
    <button onClick={() => sendTransaction({ to: "0x...", value: parseEther("0.1") })}>
      Send (no popup!)
    </button>
  )
}
```

### Use Cases

| Use Case | Why Embedded Wallets |
|----------|---------------------|
| Consumer Apps | Web2 onboarding (email/social) |
| Agent UI | Each user has self-custody wallet |
| Gaming | Instant wallet on signup |
| NFT Apps | No seed phrases, passkey auth |
| Payments | Built-in onramp, USDC rewards |

---

## Key Differences

| Feature | Server Wallets | Embedded Wallets |
|---------|---------------|------------------|
| **Control** | Developer | User (after auth) |
| **Auth** | API credentials | Email/OAuth/Passkey |
| **User confirmation** | Never | None (after session) |
| **Policy Engine** | ✅ Full | ❌ Coming soon |
| **Multi-device** | N/A | ✅ Up to 5 devices |
| **React SDK** | ❌ | ✅ Full |
| **Origin-bound** | ❌ | ✅ Yes |
| **Wagmi support** | Via viem | ✅ Native |
| **AgentKit** | ✅ Native | ❌ |

---

## Pricing (Same for Both)

| Tier | Cost |
|------|------|
| Free | 5,000 operations/month |
| Pay-as-you-go | $0.005/operation |

**Operations:** wallet creation, signing, broadcasting, policy evaluation
**Free:** all read operations

---

## Performance (Same for Both)

| Metric | Performance |
|--------|-------------|
| Wallet creation | < 500ms |
| Signing latency | < 200ms |
| Solana TPS | 225+ |
| Availability | 99.99% |

---

## Supported Chains (Same for Both)

### EVM Networks (Smart Account + EOA)
- Base, Ethereum L1, Arbitrum, Optimism, Polygon, Avalanche, BNB, Zora

### Solana (EOA only)
- Mainnet, Devnet

---

## Critical Limitations

### Server Wallets

| Limitation | Impact |
|-----------|--------|
| Rate limit: 500 writes/10s | Implement queuing |
| Wallets not visible in Portal | No UI management (coming) |
| Python requires 3.10+ | Upgrade runtime |
| ESM-only package | Use `moduleResolution: "node16"` |

### Embedded Wallets

| Limitation | Impact |
|-----------|--------|
| **Origin-bound** | Plan domain strategy early |
| 5 device limit | Educate users |
| No Policy Engine yet | Use Paymaster allowlists |
| Can't connect to external dApps | Not a MetaMask replacement |
| Passkey loss = funds lost | Recovery signer coming |

---

## When to Use Which

### Use Server Wallets When:

✅ Building AI agents
✅ Automating backend operations
✅ Treasury management
✅ Need full Policy Engine
✅ High-throughput requirements
✅ B2B/infrastructure products

### Use Embedded Wallets When:

✅ Building consumer apps
✅ Users should own their wallets
✅ Web2-style onboarding (email/social)
✅ Agent UI (each user has wallet)
✅ Need React/wagmi integration
✅ Multi-device access needed

### Hybrid Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Application                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   Frontend (User-Facing)       Backend (Operations)          │
│   ┌──────────────────┐        ┌──────────────────┐          │
│   │ Embedded Wallets │        │ Server Wallets   │          │
│   │ - User auth      │        │ - Treasury       │          │
│   │ - User txns      │        │ - Agent ops      │          │
│   │ - Gas sponsored  │        │ - Batch jobs     │          │
│   └──────────────────┘        └──────────────────┘          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## SDK Packages

### Server Wallets

```bash
# TypeScript
npm install @coinbase/cdp-sdk

# Python
pip install cdp-sdk  # Requires Python 3.10+

# Go
go get github.com/coinbase/cdp-sdk

# AgentKit
npm install @coinbase/agentkit
```

### Embedded Wallets

```bash
# Core packages
npm install @coinbase/cdp-react @coinbase/cdp-hooks @coinbase/cdp-core

# Wagmi integration
npm install @coinbase/cdp-wagmi

# Quick start
npm create cdp-app@latest
```

---

## Resources

| Resource | URL |
|----------|-----|
| Server Wallets Docs | https://docs.cdp.coinbase.com/server-wallets/v2/introduction/welcome |
| Embedded Wallets Docs | https://docs.cdp.coinbase.com/embedded-wallets/welcome |
| AgentKit | https://docs.cdp.coinbase.com/agent-kit/welcome |
| CDP Portal | https://portal.cdp.coinbase.com |
| Status Page | https://cdpstatus.coinbase.com |
| Discord | https://discord.gg/coinbasedev |

---

## Bottom Line

| Question | Answer |
|----------|--------|
| Who controls signing? | Server: You / Embedded: User (after auth) |
| Need user confirmation? | Server: No / Embedded: No (after session) |
| Can connect to Uniswap? | Server: N/A / Embedded: No (origin-bound) |
| Can sponsor gas? | Both: Yes (Smart Account only) |
| Best for agents? | Server: Yes / Embedded: For agent UI |
| Best for consumers? | Server: No / Embedded: Yes |
