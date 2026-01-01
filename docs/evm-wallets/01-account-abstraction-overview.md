# Account Abstraction: ERC-4337 vs EIP-7702

> Understanding the two approaches to smart accounts on Ethereum

---

## What is Account Abstraction?

Account Abstraction separates:
- **Who signs** (authentication)
- **Who pays gas** (sponsorship)
- **Who executes** (the account)

This enables gasless transactions, batch operations, and programmable wallets.

---

## ERC-4337 (Smart Accounts)

**Status:** Live since March 2023, no protocol changes required

### Architecture

```
EOA (signer)  ──►  UserOperation  ──►  Bundler  ──►  EntryPoint  ──►  Smart Account
                                                                            │
                                                         ┌──────────────────┘
                                                         ▼
                                                    Paymaster
                                                   (pays gas)
```

### Key Components

| Component | Role |
|-----------|------|
| **Smart Account** | Contract wallet that holds assets and executes calls |
| **UserOperation** | Pseudo-transaction signed by EOA, processed off-chain |
| **Bundler** | Collects UserOps and submits to chain |
| **EntryPoint** | Singleton contract that validates and executes UserOps |
| **Paymaster** | Optional contract that sponsors gas |

### Characteristics

| Aspect | Details |
|--------|---------|
| Address | **New address** (smart contract) |
| Transaction type | UserOperation (not native tx) |
| Gas overhead | Higher (cross-contract calls) |
| Requires | Bundler infrastructure |
| Deployment | Counterfactual (deployed on first use) |

### Code Example

```typescript
import { toSimpleSmartAccount } from "permissionless/accounts"
import { createSmartAccountClient } from "permissionless"

// Create smart account from EOA owner
const smartAccount = await toSimpleSmartAccount({
  client: publicClient,
  owner: privateKeyToAccount("0x..."),
  entryPoint: {
    address: entryPoint07Address,
    version: "0.7",
  },
})

// Send transaction (EOA signs, paymaster pays)
const txHash = await smartAccountClient.sendTransaction({
  to: "0x...",
  value: parseEther("0.1"),
})
```

---

## EIP-7702 (EOA Delegation)

**Status:** Live since Pectra upgrade (May 7, 2025)

### Architecture

```
EOA  ──►  New Tx Type (0x04)  ──►  "Delegate to contract code"  ──►  EOA executes as smart account
                                           │
                                    Temporary or permanent
                                    Reversible anytime
```

### Key Concept

EIP-7702 allows an EOA to **temporarily delegate** its execution to smart contract code, without changing addresses or migrating assets.

### Characteristics

| Aspect | Details |
|--------|---------|
| Address | **Same EOA address** |
| Transaction type | Native (type 4) |
| Gas overhead | Lower (direct execution) |
| Requires | Pectra fork (live) |
| Delegation | Reversible anytime |

### The Delegation Flow

```
1. EOA signs authorization: "delegate to contract 0xABC"
2. Transaction includes delegation tuple
3. For this tx, EOA behaves like smart contract 0xABC
4. After tx, EOA can revoke or keep delegation
```

---

## Side-by-Side Comparison

| Feature | ERC-4337 | EIP-7702 |
|---------|----------|----------|
| Address | New smart contract | Keep existing EOA |
| Migration needed | Yes (move assets) | No |
| Transaction type | UserOperation | Native (type 4) |
| Gas cost | Higher | Lower |
| Infrastructure | Bundler required | None (native) |
| Paymaster support | Yes | Yes (can combine) |
| Reversible | N/A (permanent contract) | Yes |
| Batch operations | Yes | Yes |
| Session keys | Yes | Yes |

---

## When to Use Which

### Use ERC-4337 When:
- Building new applications from scratch
- Need consistent behavior across all EVM chains
- Want sophisticated paymaster logic
- Need persistent session keys
- Users don't have existing EOA assets

### Use EIP-7702 When:
- Users have existing EOA with assets
- Want to add smart account features without migration
- Need lower gas costs
- Want reversible delegation
- Building on Ethereum mainnet post-Pectra

### Hybrid Approach

EIP-7702 can delegate to ERC-4337 compatible code, getting both:
- Keep existing EOA address
- Use bundler/paymaster infrastructure

```
EOA (0x123...)
    │
    ├── EIP-7702 delegation to ERC-4337 account code
    │
    └── Now works with bundlers + paymasters
        while keeping original address
```

---

## Key Takeaways

1. **ERC-4337** = New smart contract wallet, works everywhere today
2. **EIP-7702** = Upgrade existing EOA, requires Pectra (live May 2025)
3. **Not competing** - they're complementary
4. **Both support** gas sponsorship, batching, programmability
5. **EIP-7702** solves the "migration problem" for existing users

---

## Resources

- [ERC-4337 Specification](https://eips.ethereum.org/EIPS/eip-4337)
- [EIP-7702 Specification](https://eips.ethereum.org/EIPS/eip-7702)
- [Pimlico: ERC-4337 vs EIP-7702](https://docs.pimlico.io/guides/eip7702/erc4337-vs-eip7702)
- [Viem Account Abstraction](https://viem.sh/account-abstraction)
- [permissionless.js](https://docs.pimlico.io/permissionless)
