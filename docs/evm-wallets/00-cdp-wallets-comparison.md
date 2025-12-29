# CDP Wallets Comparison: Server vs Embedded

> One-pager for developers choosing between Coinbase Developer Platform wallet solutions

---

## Quick Decision Matrix

| Use Case | Recommended |
|----------|-------------|
| AI agents / autonomous trading | **Server Wallets** |
| Backend automation / treasury | **Server Wallets** |
| Consumer apps with user wallets | **Embedded Wallets** |
| Agent UI with user-owned wallets | **Embedded Wallets** |
| High-throughput systems (225+ TPS) | **Server Wallets** |

---

## Architecture Comparison

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SERVER WALLETS                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Your Backend                    CDP Infrastructure                         │
│   ┌──────────────┐               ┌─────────────────────┐                    │
│   │ API Key +    │───────────────│  AWS Nitro Enclave  │                    │
│   │ Wallet Secret│   API calls   │  (TEE)              │                    │
│   └──────────────┘               │  - Key generation   │                    │
│                                  │  - Signing          │                    │
│   Developer controls             │  - Never exposed    │                    │
│   all operations                 └─────────────────────┘                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        EMBEDDED WALLETS                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   User Device                     CDP Infrastructure                         │
│   ┌──────────────┐               ┌─────────────────────┐                    │
│   │ Email/OAuth  │───────────────│  AWS Nitro Enclave  │                    │
│   │ Auth         │   Session     │  (TEE)              │                    │
│   └──────────────┘               │  - Per-user keys    │                    │
│         │                        │  - Policy-gated     │                    │
│   User authenticates             └─────────────────────┘                    │
│   once, then seamless                                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Feature Comparison

| Feature | Server Wallets | Embedded Wallets |
|---------|---------------|------------------|
| **Control Model** | Developer-controlled | User-controlled (after auth) |
| **Authentication** | API Key + Wallet Secret | Email, SMS, OAuth, Passkeys |
| **Signing** | Fully automatic via API | Automatic after user session |
| **User Confirmation** | None required | None (configurable) |
| **Policy Engine** | Full support | Coming soon (Paymaster only) |
| **Smart Accounts** | Yes (ERC-4337) | Yes (ERC-4337) |
| **Gas Sponsorship** | Yes | Yes |
| **Multi-device** | N/A | Up to 5 devices |
| **Signing Latency** | < 200ms | < 200ms |
| **Wallet Creation** | < 500ms | < 500ms |
| **Max TPS** | 225+ (Solana) | Session-based |

---

## Supported Chains

| Chain | Server Wallets | Embedded Wallets |
|-------|---------------|------------------|
| Base | EOA + Smart | EOA + Smart |
| Ethereum | EOA + Smart | EOA + Smart |
| Arbitrum | EOA + Smart | EOA + Smart |
| Optimism | EOA + Smart | EOA + Smart |
| Polygon | EOA + Smart | EOA + Smart |
| Avalanche | EOA + Smart | EOA + Smart |
| BNB Chain | EOA + Smart | EOA + Smart |
| Zora | EOA + Smart | EOA + Smart |
| Solana | EOA only | EOA only |

---

## Pricing

| Tier | Cost |
|------|------|
| Free | 5,000 operations/month |
| Pay-as-you-go | $0.005/operation |

**Operations include:** wallet creation, signing, broadcasting, policy evaluation
**Free:** all read operations

---

## Integration Comparison

### Server Wallets

```typescript
// Install
npm install @coinbase/cdp-sdk

// Initialize
import { CdpClient } from "@coinbase/cdp-sdk";

const cdp = new CdpClient({
  apiKeyId: process.env.CDP_API_KEY_ID,
  apiKeySecret: process.env.CDP_API_KEY_SECRET,
  walletSecret: process.env.CDP_WALLET_SECRET,
});

// Create account & sign (fully automated)
const account = await cdp.evm.createAccount();
const tx = await cdp.evm.sendTransaction({
  account,
  to: "0x...",
  value: parseEther("0.01"),
});
```

### Embedded Wallets

```typescript
// Install
npm install @coinbase/cdp-wagmi @coinbase/cdp-core viem wagmi

// Configure
const cdpConfig = {
  projectId: "your-project-id",
  ethereum: { createOnLogin: "smart" }  // or "eoa"
};

// React Component
function App() {
  return (
    <CDPProvider config={cdpConfig}>
      <AuthButton />  {/* User signs in with email */}
      <SendTransactionButton to="0x..." value="0.01" />
    </CDPProvider>
  );
}
```

---

## DX Issues & Gotchas

### Server Wallets

| Issue | Severity | Workaround |
|-------|----------|------------|
| `waitForReceipt` hangs on dropped txs | High | Implement timeout wrapper |
| Concurrent calls exceed rate limits | Medium | Implement request queuing |
| Missing network param fails silently | Medium | Always specify network |
| Credentials in error logs | High | Sanitize logs in production |
| Wallets not visible in Portal | Low | Feature coming soon |
| Python SDK requires 3.10+ | Low | Upgrade Python version |

### Embedded Wallets

| Issue | Severity | Workaround |
|-------|----------|------------|
| Origin-bound wallets | High | Plan domain strategy early |
| 5 device limit | Medium | Document for users |
| Passkey not syncing (Google→Apple) | High | Recommend platform-native passkeys |
| iOS Safari signing fails | Medium | Disable "Block Pop-ups" |
| `accountsChanged` event inconsistent | Medium | Poll connection state |
| Policy Engine not available yet | Medium | Use Paymaster allowlists |

### Common to Both

| Issue | Severity | Workaround |
|-------|----------|------------|
| ESM-only package | Medium | Use `moduleResolution: "node16"` |
| Node.js network timeout | Medium | Set `NODE_OPTIONS="--network-family-autoselection-attempt-timeout=500"` |
| Ambiguous error messages | High | Wrap with custom error handling |
| Rate limit: 500 writes/10s | Medium | Implement backoff strategy |

---

## UX Issues & Gotchas

### Embedded Wallets (User-Facing)

| Issue | Impact | Mitigation |
|-------|--------|------------|
| Passkey deleted = funds lost | Critical | Educate users, enable recovery signer (when available) |
| Generic "Something went wrong" | High | Implement custom error UI |
| Chrome profile-specific passkeys | Medium | Document for users |
| Smart Wallet not in Coinbase app | Medium | Direct users to wallet.coinbase.com |
| keys.coinbase.com dependency | Medium | Plan for recovery signer feature |

### Recovery Limitations

- No recovery signer available yet (planned)
- Passkeys tied to `keys.coinbase.com` domain
- If user loses all devices with passkey, funds are **permanently lost**

---

## Security Model

### Server Wallets

```
┌────────────────────────────────────────────────────┐
│ Policy Engine (enforced in TEE)                    │
├────────────────────────────────────────────────────┤
│ • Recipient allowlist/denylist                     │
│ • Transfer amount limits (min/max)                 │
│ • USD spend limits per transaction                 │
│ • Contract method restrictions                     │
│ • Call data validation                             │
│ • Message signing controls                         │
│ • Coinbase KYT integration (coming soon)           │
└────────────────────────────────────────────────────┘
```

### Embedded Wallets

```
┌────────────────────────────────────────────────────┐
│ User Authentication Layer                          │
├────────────────────────────────────────────────────┤
│ • Email/SMS OTP verification                       │
│ • OAuth (Google, Apple)                            │
│ • Session management                               │
│ • Domain allowlisting (required)                   │
└────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────┐
│ Paymaster Controls (limited policy)                │
├────────────────────────────────────────────────────┤
│ • Gas sponsorship allowlists                       │
│ • Spend permissions (if enabled)                   │
│ • Full Policy Engine coming soon                   │
└────────────────────────────────────────────────────┘
```

---

## When to Use What

### Use Server Wallets When:

- Building AI agents (AgentKit integration)
- Automating trading/treasury operations
- Backend needs to sign without user interaction
- High-throughput requirements (225+ TPS)
- Need full Policy Engine controls
- Building B2B/infrastructure products

### Use Embedded Wallets When:

- Building consumer-facing apps
- Users should "own" their wallets
- Web2-style onboarding required (email/social)
- Building agent UI where each user has a wallet
- Need wagmi/React integration
- Users may access from multiple devices

### Hybrid Approach:

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Application                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   User-Facing Layer              Backend Layer               │
│   ┌──────────────────┐          ┌──────────────────┐        │
│   │ Embedded Wallets │          │ Server Wallets   │        │
│   │ - User auth      │          │ - Treasury ops   │        │
│   │ - User txns      │          │ - Agent actions  │        │
│   │ - Gas sponsored  │          │ - Batch jobs     │        │
│   └──────────────────┘          └──────────────────┘        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## SDK Packages Reference

### Server Wallets

| Package | Language | Notes |
|---------|----------|-------|
| `@coinbase/cdp-sdk` | TypeScript | Primary SDK |
| `cdp-sdk` | Python | Requires Python 3.10+ |
| `github.com/coinbase/cdp-sdk` | Go | Production-ready |
| `cdp-sdk` | Rust | Full support |
| `@coinbase/agentkit` | TypeScript | AI agent toolkit |

### Embedded Wallets

| Package | Purpose |
|---------|---------|
| `@coinbase/cdp-react` | UI components (AuthButton, SendTransactionButton) |
| `@coinbase/cdp-hooks` | React hooks (useEvmAddress, useSendEvmTransaction) |
| `@coinbase/cdp-wagmi` | Wagmi connector |
| `@coinbase/cdp-core` | Core logic (non-React) |
| `@coinbase/create-cdp-app` | CLI scaffolding |

---

## Resources

| Resource | URL |
|----------|-----|
| Server Wallets Docs | https://docs.cdp.coinbase.com/server-wallets/v2/introduction/welcome |
| Embedded Wallets Docs | https://docs.cdp.coinbase.com/embedded-wallets/welcome |
| AgentKit Docs | https://docs.cdp.coinbase.com/agent-kit/welcome |
| Paymaster Docs | https://docs.cdp.coinbase.com/paymaster/introduction/welcome |
| CDP Portal | https://portal.cdp.coinbase.com |
| Status Page | https://cdpstatus.coinbase.com |
| Discord | https://discord.gg/coinbasedev |
| GitHub (SDK) | https://github.com/coinbase/cdp-sdk |
| GitHub (AgentKit) | https://github.com/coinbase/agentkit |
| Live Demo | https://demo.cdp.coinbase.com |

---

## Bottom Line

| Wallet Type | TL;DR |
|-------------|-------|
| **Server Wallets** | You control everything. Best for agents, automation, backend ops. Full policy engine. |
| **Embedded Wallets** | Users own wallets with Web2 UX. Best for consumer apps. Policy engine coming soon. |

**For your agent UI use case** (user gets wallet on email signup, background txns):
- **Embedded Wallets** with `createOnLogin: "smart"`
- Gas sponsored via CDP Paymaster
- User authenticates once, then txns sign automatically
- Be aware: no full policy engine yet, plan recovery strategy

---

*Generated: December 2024*
