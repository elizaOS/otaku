# Web3 Wallet Implementation Guides

> Comprehensive documentation on Account Abstraction, CDP Wallets, and Smart Account implementation

---

## Guide Overview

This documentation series covers everything you need to know about implementing modern Web3 wallets, from account abstraction fundamentals to production deployment.

### 📚 Reading Order

1. **[CDP Wallets Comparison](00-cdp-wallets-comparison.md)** - Quick one-pager comparing Server vs Embedded wallets
2. **[Account Abstraction Overview](01-account-abstraction-overview.md)** - Understanding ERC-4337 vs EIP-7702
3. **[CDP Wallets Deep Dive](02-cdp-wallets-deep-dive.md)** - Complete guide to Server and Embedded wallets
4. **[Gas Sponsorship & Paymasters](03-gas-sponsorship-paymasters.md)** - Gasless transactions and ERC-20 gas payments
5. **[Signing Mechanisms](04-signing-mechanisms.md)** - How different wallet types sign transactions
6. **[Decision Guide](05-decision-guide.md)** - Choosing the right wallet architecture for your use case

---

## Quick Links

### New to Account Abstraction?
Start with **[01-account-abstraction-overview.md](01-account-abstraction-overview.md)** to understand the fundamentals.

### Choosing Between CDP Products?
Go straight to **[00-cdp-wallets-comparison.md](00-cdp-wallets-comparison.md)** for a side-by-side comparison.

### Ready to Implement?
Jump to **[05-decision-guide.md](05-decision-guide.md)** for specific recommendations based on your use case.

---

## What's Covered

### Account Abstraction
- ERC-4337 (Smart Accounts)
- EIP-7702 (EOA Delegation)
- UserOperations vs Transactions
- Bundlers and EntryPoints

### CDP Wallet Products
- Server Wallets (developer-controlled)
- Embedded Wallets (user-controlled)
- Architecture and security (TEE)
- Policy Engine
- Multi-device support

### Gas Sponsorship
- Paymaster types (gasless, ERC-20)
- CDP Paymaster
- Circle Paymaster
- Third-party options (Pimlico, Alchemy)
- Implementation examples

### Signing
- EOA signing (secp256k1)
- Smart Account signing (ERC-4337)
- Passkey signing (secp256r1, WebAuthn)
- TEE-based signing
- EIP-1271 verification
- Session keys

### Implementation
- Code examples (TypeScript, React)
- SDK usage (@coinbase/cdp-sdk)
- Wagmi integration
- Best practices
- Common pitfalls
- Cost estimation

---

## Use Case Index

Find the right guide for your specific scenario:

| Use Case | Primary Guide | Supporting Guides |
|----------|--------------|-------------------|
| **AI Agent** | [02-CDP Wallets](02-cdp-wallets-deep-dive.md#server-wallets) | [03-Paymasters](03-gas-sponsorship-paymasters.md), [05-Decision](05-decision-guide.md#scenario-1-ai-trading-agent) |
| **Consumer App** | [02-CDP Wallets](02-cdp-wallets-deep-dive.md#embedded-wallets) | [03-Paymasters](03-gas-sponsorship-paymasters.md), [05-Decision](05-decision-guide.md#decision-tree-2-consumer-applications) |
| **Agent UI** | [05-Decision Guide](05-decision-guide.md#decision-tree-3-agent-ui-users--automation) | [02-CDP Wallets](02-cdp-wallets-deep-dive.md#embedded-wallets), [03-Paymasters](03-gas-sponsorship-paymasters.md) |
| **Gaming** | [05-Decision Guide](05-decision-guide.md#scenario-5-gaming) | [02-CDP Wallets](02-cdp-wallets-deep-dive.md), [04-Signing](04-signing-mechanisms.md#session-keys) |
| **Payments/USDC** | [03-Paymasters](03-gas-sponsorship-paymasters.md#erc-20-gas-payment-deep-dive) | [05-Decision](05-decision-guide.md#scenario-4-stablecoin-payments) |
| **NFT Platform** | [05-Decision Guide](05-decision-guide.md#scenario-2-nft-minting-platform) | [03-Paymasters](03-gas-sponsorship-paymasters.md) |

---

## Key Concepts

### Account Types
```
EOA (Externally Owned Account)
  - Private key controlled
  - Direct signing
  - Lower gas costs
  - No paymaster support

Smart Account (ERC-4337)
  - Contract-based
  - Programmable
  - Gas sponsorship
  - Batch operations
  - Session keys
```

### Wallet Products
```
Server Wallets
  - Developer controls
  - Backend/agents
  - Full Policy Engine
  - AgentKit integration

Embedded Wallets
  - User controls
  - Web2 onboarding
  - React SDK
  - Origin-bound
```

### Gas Models
```
Traditional
  - User needs ETH
  - User pays per transaction

Gasless (Paymaster)
  - Developer sponsors
  - User has no ETH

ERC-20 (Paymaster)
  - User pays in USDC/tokens
  - No ETH needed
```

---

## Code Examples

### Server Wallet Quick Start
```typescript
import { CdpClient } from "@coinbase/cdp-sdk"

const cdp = new CdpClient()
const account = await cdp.evm.createAccount()

const tx = await cdp.evm.sendTransaction({
  account,
  to: "0x...",
  value: parseEther("0.1"),
})
```

### Embedded Wallet Quick Start
```typescript
import { CDPProvider, AuthButton } from "@coinbase/cdp-react"

const cdpConfig = {
  projectId: "your-project-id",
  ethereum: { createOnLogin: "smart" }
}

<CDPProvider config={cdpConfig}>
  <AuthButton />
  <SendEvmTransactionButton to="0x..." value="0.1" />
</CDPProvider>
```

### Gasless Transaction
```typescript
const { userOpHash } = await cdp.evm.sendUserOperation({
  smartAccount,
  network: "base",
  calls: [{...}],
  paymasterUrl: CDP_PAYMASTER_URL,
})
```

---

## Additional Resources

### Official Documentation
- [CDP Server Wallets](https://docs.cdp.coinbase.com/server-wallets/v2)
- [CDP Embedded Wallets](https://docs.cdp.coinbase.com/embedded-wallets)
- [CDP Paymaster](https://docs.cdp.coinbase.com/paymaster)
- [AgentKit](https://docs.cdp.coinbase.com/agent-kit)

### Developer Tools
- [CDP Portal](https://portal.cdp.coinbase.com)
- [Status Page](https://cdpstatus.coinbase.com)
- [Discord](https://discord.gg/coinbasedev)

### Standards
- [ERC-4337 Spec](https://eips.ethereum.org/EIPS/eip-4337)
- [EIP-7702 Spec](https://eips.ethereum.org/EIPS/eip-7702)
- [EIP-1271 Spec](https://eips.ethereum.org/EIPS/eip-1271)
- [ERC-7677 Spec](https://eips.ethereum.org/EIPS/eip-7677)

---

## Document Status

| Guide | Status | Last Updated |
|-------|--------|--------------|
| 00-cdp-wallets-comparison.md | ✅ Complete | Dec 27, 2024 |
| 01-account-abstraction-overview.md | ✅ Complete | Dec 29, 2024 |
| 02-cdp-wallets-deep-dive.md | ✅ Complete | Dec 29, 2024 |
| 03-gas-sponsorship-paymasters.md | ✅ Complete | Dec 29, 2024 |
| 04-signing-mechanisms.md | ✅ Complete | Dec 29, 2024 |
| 05-decision-guide.md | ✅ Complete | Dec 29, 2024 |

---

## Contributing

These guides were generated from a comprehensive research session covering:
- CDP wallet products and architecture
- Account abstraction standards (ERC-4337, EIP-7702)
- Paymaster implementations
- Real-world DX/UX issues
- Production deployment patterns

To update or expand these guides:
1. Verify information against latest CDP documentation
2. Test code examples in development environment
3. Update relevant sections across all guides
4. Maintain consistency in terminology and examples

---

## License

These guides are provided for educational and reference purposes as part of the Otaku project.
