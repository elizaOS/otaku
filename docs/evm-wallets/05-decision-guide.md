# Web3 Wallet Implementation Decision Guide

> A flowchart-style guide to choosing the right wallet architecture

---

## Start Here: What Are You Building?

```
┌─────────────────────────────────────────────────────────────┐
│                 What are you building?                       │
└─────────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   Backend/Agent      Consumer App      Both (Hybrid)
```

---

## Decision Tree 1: Backend/Agent Systems

### Question 1: Who controls the wallet?

```
Your backend/agent needs to sign transactions without user interaction?
     │
     ├─► YES → CDP Server Wallets ✅
     │
     └─► NO → Consider if you actually need blockchain
```

### Question 2: What level of throughput?

| TPS Needed | Solution |
|------------|----------|
| < 10 TPS | CDP Server Wallets (EOA or Smart) |
| 10-100 TPS | CDP Server Wallets (Smart Account) |
| 100+ TPS | CDP Server Wallets on Solana (225+ TPS) |

### Question 3: Do you need gas sponsorship?

```
Need to sponsor gas for operations?
     │
     ├─► YES → Smart Account + Paymaster
     │
     └─► NO → EOA (cheaper, simpler)
```

### Question 4: What controls do you need?

| Need | Solution |
|------|----------|
| Spending limits | Policy Engine (Server Wallets) |
| Contract allowlists | Policy Engine (Server Wallets) |
| USD spend caps | Policy Engine (Server Wallets) |
| Just basic signing | EOA |

### Recommended Stack

```typescript
// Backend Agent Example
import { CdpClient } from "@coinbase/cdp-sdk"

const cdp = new CdpClient()

// Smart Account for gas sponsorship + policies
const owner = await cdp.evm.getOrCreateAccount({ name: "Owner" })
const smartAccount = await cdp.evm.getOrCreateSmartAccount({
  name: "AgentWallet",
  owner
})

// Configure policies
await cdp.createPolicy({
  scope: "account",
  accountId: smartAccount.id,
  rules: [{
    operation: "signEvmTransaction",
    action: "accept",
    criteria: {
      type: "ethValue",
      operator: "<=",
      values: ["1000000000000000000"]  // Max 1 ETH
    }
  }]
})

// Sign automatically with policies enforced
const { userOpHash } = await cdp.evm.sendUserOperation({
  smartAccount,
  network: "base",
  calls: [{...}],
  paymasterUrl: CDP_PAYMASTER_URL,
})
```

---

## Decision Tree 2: Consumer Applications

### Question 1: Do users own their wallets?

```
Should users have self-custody?
     │
     ├─► YES → Go to Question 2
     │
     └─► NO → You probably want custodial (not CDP)
```

### Question 2: What kind of onboarding?

| User Expectation | Solution |
|-----------------|----------|
| Email/social login | CDP Embedded Wallets ✅ |
| Download MetaMask | Don't use embedded - use WalletConnect |
| Passkey auth | CDP Embedded Wallets or Coinbase Smart Wallet |
| Seed phrase | Traditional wallet (not CDP Embedded) |

### Question 3: Do they need to connect to other dApps?

```
Will users connect to Uniswap, OpenSea, etc?
     │
     ├─► YES → Use Coinbase Wallet (consumer app)
     │          or WalletConnect
     │
     └─► NO → CDP Embedded Wallets ✅
               (users stay in your app)
```

### Question 4: Do you want gasless UX?

```
Should transactions be free for users?
     │
     ├─► YES (you pay) → Smart Account + CDP Paymaster
     │
     ├─► YES (user pays in USDC) → Smart Account + ERC-20 Paymaster
     │
     └─► NO (user pays ETH) → Can use EOA
```

### Question 5: What chains?

| Requirement | Compatible |
|------------|-----------|
| Base only | ✅ Perfect fit |
| Multi-chain EVM | ✅ All EVM chains supported |
| Solana | ✅ Supported |
| Bitcoin | ❌ Not supported |

### Recommended Stack

```typescript
// Consumer App Example
import { CDPProvider } from "@coinbase/cdp-react"
import { createCDPEmbeddedWalletConnector } from "@coinbase/cdp-wagmi"

const cdpConfig = {
  projectId: "your-project-id",
  ethereum: {
    createOnLogin: "smart",  // For gas sponsorship
    enableSpendPermissions: true,  // For recurring payments
  }
}

function App() {
  return (
    <CDPProvider config={cdpConfig}>
      {/* User signs up with email */}
      <AuthButton />

      {/* Gasless transactions */}
      <SendUserOperationButton
        calls={[{...}]}
        useCdpPaymaster={true}
      />
    </CDPProvider>
  )
}
```

---

## Decision Tree 3: Agent UI (Users + Automation)

Your use case: **"Users sign up with email, agent executes transactions in background"**

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Agent UI App                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   User Signs Up (Email)                                      │
│         │                                                    │
│         ▼                                                    │
│   CDP Embedded Wallet Created                                │
│   (User owns, self-custody)                                  │
│         │                                                    │
│         ▼                                                    │
│   Agent executes transactions                                │
│   (Signs automatically in TEE)                               │
│   (No user confirmation popup)                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Recommended Setup

```typescript
// 1. User onboarding
const cdpConfig = {
  projectId: "your-project-id",
  ethereum: {
    createOnLogin: "smart",  // For gas sponsorship
  }
}

// 2. Agent executes in background
function AgentUI() {
  const { evmAddress } = useEvmAddress()
  const { sendUserOperation } = useSendUserOperation()

  // Agent logic runs in background
  useEffect(() => {
    const runAgent = async () => {
      // Execute trading strategy
      await sendUserOperation({
        calls: [{
          to: TRADING_CONTRACT,
          data: encodeFunctionData({...}),
        }],
        useCdpPaymaster: true,  // Gasless
      })
    }

    // Run every 5 minutes
    const interval = setInterval(runAgent, 300000)
    return () => clearInterval(interval)
  }, [evmAddress])

  return <div>Agent running for {evmAddress}...</div>
}
```

### Critical Considerations

| Concern | Solution |
|---------|----------|
| User trust | Explain what agent does, show transaction history |
| Recovery | Implement recovery signer when available |
| Spending limits | Use Paymaster allowlists (Policy Engine coming soon) |
| Transparency | Log all agent actions |

---

## Account Type Decision: EOA vs Smart Account

### When to use EOA

```
Use EOA if:
  ✅ Simple send/receive
  ✅ Don't need gas sponsorship
  ✅ Lower gas costs important
  ✅ Standard wallet interop
  ❌ Can't use paymasters
  ❌ Can't batch transactions
  ❌ No session keys
```

### When to use Smart Account

```
Use Smart Account if:
  ✅ Gas sponsorship needed
  ✅ Batch transactions needed
  ✅ Session keys wanted
  ✅ Programmable rules
  ✅ ERC-20 gas payment
  ❌ Higher gas costs
  ❌ More complex setup
```

---

## Gas Payment Decision Matrix

| Scenario | Account Type | Paymaster | Gas Payer |
|----------|-------------|-----------|-----------|
| User pays ETH | EOA or Smart | None | User |
| You sponsor | Smart Account | CDP Paymaster | You |
| User pays USDC | Smart Account | ERC-20 Paymaster | User (in USDC) |
| User has no crypto | Smart Account | CDP Paymaster | You |

---

## Chain Decision

### Base-First Strategy (Recommended)

```
Start on Base because:
  ✅ CDP Paymaster native support
  ✅ Extremely low gas costs (~$0.0001/tx)
  ✅ Native USDC
  ✅ Coinbase ecosystem
  ✅ Fast finality
  ✅ 15M+ gasless txns proven
```

### Multi-Chain Strategy

```
Base (primary)
  ├── CDP Paymaster for gas sponsorship
  ├── Lowest costs
  └── Best CDP integration

Ethereum L1
  ├── Use for high-value ops only
  ├── Higher gas costs
  └── Smart Account more expensive

Other EVM (Arbitrum, Optimism, Polygon)
  ├── Third-party paymasters (Pimlico, Alchemy)
  ├── Same smart account address
  └── Cross-chain operations possible

Solana
  ├── Different account model
  ├── 225+ TPS for agents
  └── Lower costs than Ethereum L1
```

---

## Common Scenarios: Recommended Solutions

### Scenario 1: AI Trading Agent

```
Requirements:
  - Automated trading
  - High throughput
  - Spending limits
  - No user interaction

Solution:
  ✅ CDP Server Wallets
  ✅ Smart Account
  ✅ Policy Engine for limits
  ✅ Solana if >100 TPS needed
  ✅ Base for lower costs
```

### Scenario 2: NFT Minting Platform

```
Requirements:
  - Users mint NFTs
  - Gasless for users
  - Email onboarding
  - Stay in app

Solution:
  ✅ CDP Embedded Wallets
  ✅ Smart Account
  ✅ CDP Paymaster (you sponsor)
  ✅ Base network
```

### Scenario 3: DeFi Dashboard

```
Requirements:
  - Users connect existing wallets
  - Use Uniswap, Aave, etc.
  - Power users with MetaMask

Solution:
  ❌ NOT CDP Embedded (can't connect to external dApps)
  ✅ WalletConnect
  ✅ RainbowKit
  ✅ wagmi with multiple connectors
```

### Scenario 4: Stablecoin Payments

```
Requirements:
  - Users pay in USDC
  - No ETH needed
  - Recurring payments
  - Email signup

Solution:
  ✅ CDP Embedded Wallets
  ✅ Smart Account
  ✅ ERC-20 Paymaster (Circle or CDP)
  ✅ Spend Permissions for recurring
  ✅ Base network
```

### Scenario 5: Gaming

```
Requirements:
  - Instant wallet on signup
  - Gasless in-game txns
  - Session keys for gameplay
  - Users own assets

Solution:
  ✅ CDP Embedded Wallets
  ✅ Smart Account
  ✅ CDP Paymaster
  ✅ Session keys for game contract
  ✅ Base network
```

### Scenario 6: Enterprise Treasury

```
Requirements:
  - Multi-sig
  - Compliance controls
  - Audit trail
  - High security

Solution:
  ✅ CDP Server Wallets
  ✅ Smart Account
  ✅ Policy Engine (full rules)
  ✅ Multiple owners
  ✅ KYT integration (coming)
```

---

## Red Flags: When NOT to Use CDP

### Don't use CDP Embedded Wallets if:

❌ Users need to connect to external dApps (Uniswap, OpenSea)
❌ Users want to use hardware wallets
❌ Users demand seed phrase custody
❌ You need cross-app wallet portability
❌ You're building a wallet itself

### Don't use CDP Server Wallets if:

❌ Users need to control their own keys
❌ You want zero vendor lock-in
❌ You need <1ms signing latency
❌ You can't trust any third party
❌ Regulatory prohibits custodial-like models

---

## Migration Paths

### From MetaMask to CDP Embedded

```
Challenge: Users can't "connect" existing wallets

Solutions:
  1. Key export → import to CDP (one-time)
  2. Gradual: New users → CDP, existing → MetaMask
  3. Dual-wallet: Critical assets in MetaMask, daily use in CDP
```

### From CDP Embedded to External Wallet

```
User wants to use Uniswap:
  1. Export private key from CDP
  2. Import to MetaMask
  3. User now controls directly
```

---

## Cost Estimation

### CDP Embedded Wallets (Consumer App)

```
Assumptions:
  - 10,000 active users
  - 5 transactions/user/month
  - Smart Account on Base
  - Gas sponsored by you

Costs:
  CDP Operations: 50,000 ops × $0.005 = $250/mo
  Gas on Base: 50,000 txs × $0.0001 = $5/mo
  ─────────────────────────────────────────────
  Total: ~$255/mo

  (After free tier: 5,000 ops free)
  Actual: ~$230/mo
```

### CDP Server Wallets (Agent)

```
Assumptions:
  - 1 agent wallet
  - 1,000 trades/day
  - Smart Account on Solana
  - No gas sponsorship

Costs:
  CDP Operations: 30,000 ops/mo × $0.005 = $150/mo
  Solana gas: 30,000 txs × $0.00001 = $0.30/mo
  ─────────────────────────────────────────────
  Total: ~$150/mo

  (After free tier)
  Actual: ~$125/mo
```

---

## Quick Decision Matrix

| Your Situation | Recommended Solution |
|---------------|---------------------|
| Backend automation | Server Wallets + Smart Account |
| AI agent | Server Wallets + AgentKit |
| Consumer app (stay in app) | Embedded Wallets + Smart Account |
| Consumer app (connect to dApps) | WalletConnect |
| Agent UI (user wallets) | Embedded Wallets + Smart Account |
| Enterprise treasury | Server Wallets + Policy Engine |
| Gaming | Embedded Wallets + Session Keys |
| Payments (USDC) | Embedded Wallets + ERC-20 Paymaster |
| NFT minting | Embedded Wallets + CDP Paymaster |
| Multi-sig | Server Wallets + Multiple owners |

---

## Implementation Checklist

### For CDP Server Wallets

- [ ] Sign up at portal.cdp.coinbase.com
- [ ] Create API Key (enable View, Trade, Transfer)
- [ ] Create Wallet Secret
- [ ] Install SDK: `npm i @coinbase/cdp-sdk`
- [ ] Decide: EOA or Smart Account?
- [ ] If Smart Account: Set up Paymaster
- [ ] Configure Policy Engine rules
- [ ] Implement monitoring & alerts
- [ ] Test on testnet (Base Sepolia)
- [ ] Deploy to mainnet

### For CDP Embedded Wallets

- [ ] Sign up at portal.cdp.coinbase.com
- [ ] Get Project ID
- [ ] Allowlist domains (dev, staging, prod)
- [ ] Install packages: `npm i @coinbase/cdp-react @coinbase/cdp-hooks`
- [ ] Configure: EOA or Smart Account?
- [ ] Set up Paymaster (if needed)
- [ ] Implement auth flow
- [ ] Test on testnet
- [ ] Plan recovery strategy
- [ ] Educate users about passkeys
- [ ] Deploy to mainnet

---

## Resources

| Resource | URL |
|----------|-----|
| CDP Portal | https://portal.cdp.coinbase.com |
| Server Wallets Docs | https://docs.cdp.coinbase.com/server-wallets/v2 |
| Embedded Wallets Docs | https://docs.cdp.coinbase.com/embedded-wallets |
| Paymaster Docs | https://docs.cdp.coinbase.com/paymaster |
| AgentKit | https://docs.cdp.coinbase.com/agent-kit |
| Discord | https://discord.gg/coinbasedev |
| Status | https://cdpstatus.coinbase.com |
