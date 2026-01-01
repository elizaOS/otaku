# Gas Sponsorship & Paymasters Guide

> Complete guide to gasless transactions and ERC-20 gas payments

---

## What is a Paymaster?

A **Paymaster** is a smart contract in the ERC-4337 ecosystem that pays gas fees on behalf of users.

```
User wants to send tx
     │
     ├── Signs UserOperation (no ETH needed)
     │
     ▼
┌─────────────────────────────────────────┐
│  Bundler                                 │
│  - Collects UserOp                       │
│  - Queries Paymaster                     │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│  Paymaster Smart Contract                │
│  - Validates UserOp                      │
│  - Agrees to pay gas                     │
│  - Returns signature                     │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│  EntryPoint                              │
│  - Executes UserOp                       │
│  - Charges gas to Paymaster              │
└─────────────────────────────────────────┘
```

---

## Types of Paymasters

### 1. Gasless Paymaster (Developer Pays)

You sponsor all gas fees for your users.

```typescript
// CDP Server Wallet example
const { userOpHash } = await cdp.evm.sendUserOperation({
  smartAccount,
  network: "base",
  calls: [{
    to: "0x...",
    value: parseEther("0.1"),
  }],
  paymasterUrl: CDP_PAYMASTER_URL,  // You pay
})
```

**Use cases:**
- Onboarding (first tx free)
- NFT mints
- Gaming transactions
- Consumer apps

### 2. ERC-20 Paymaster (User Pays in Tokens)

User pays gas in USDC or other ERC-20 instead of ETH.

```typescript
const { userOpHash } = await cdp.evm.sendUserOperation({
  smartAccount,
  network: "base",
  calls: [{
    to: "0x...",
    value: 0n,
  }],
  paymasterUrl: PAYMASTER_URL,
  paymasterContext: {
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"  // USDC on Base
  }
})
```

**How it works:**
```
User has USDC, no ETH
     │
     ├── Approves Paymaster to spend USDC
     │
     ▼
┌─────────────────────────────────────────┐
│  Paymaster                               │
│  - Pays ETH for gas                      │
│  - Deducts USDC from user                │
│  - (Optional) Takes fee                  │
└─────────────────────────────────────────┘
```

**Use cases:**
- Stablecoin-only users
- Cross-border payments
- DeFi apps
- Merchant payments

---

## Paymaster Providers

| Provider | Type | Tokens | Fee | Networks |
|----------|------|--------|-----|----------|
| **CDP Paymaster** | Gasless + ERC-20 | USDC, custom | TBD | Base only |
| **Circle Paymaster** | ERC-20 | USDC only | 10% | Base, Arbitrum |
| **Pimlico** | Gasless + ERC-20 | Multiple | Varies | Multi-chain |
| **Alchemy** | Gasless + ERC-20 | Multiple | Varies | Multi-chain |
| **Stackup** | Gasless + ERC-20 | Multiple | Varies | Multi-chain |

---

## CDP Paymaster (Base)

### Features

```
CDP Paymaster = Bundler + Paymaster (single endpoint)
```

- **15M+ transactions** processed (as of Dec 2024)
- **50+ apps** using it
- **Base only** (Sepolia testnet + mainnet)
- **ERC-7677 compliant**
- **Automatic on testnets** (Base Sepolia)

### Sponsorship Models

| Network | Default Behavior | Notes |
|---------|-----------------|-------|
| Base Sepolia | Auto-sponsored | Free for all Smart Accounts |
| Base Mainnet | Need `paymasterUrl` | You pay (or user with ERC-20) |

### Setup

```typescript
// 1. Get Paymaster endpoint from CDP Portal
// portal.cdp.coinbase.com → Paymaster

// 2. Allowlist contracts (optional)
// Only sponsor txns to specific contracts

// 3. Use in code
const { userOpHash } = await cdp.evm.sendUserOperation({
  smartAccount,
  network: "base",
  calls: [{
    to: ALLOWED_CONTRACT,
    data: encodeFunctionData({...}),
  }],
  paymasterUrl: process.env.CDP_PAYMASTER_URL,
})
```

### Gas Credits

- Up to **$15k in gas credits** via Base Gasless Campaign
- Check current promotions at portal.cdp.coinbase.com

---

## ERC-20 Gas Payment Deep Dive

### Supported Tokens (CDP Paymaster)

| Token | Address (Base) | Status |
|-------|---------------|--------|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | ✅ Supported |
| Custom tokens | App-specific | ✅ Early Access |

### How User Pays in USDC

```typescript
// User's smart account has USDC, no ETH
const smartAccount = await cdp.evm.getOrCreateSmartAccount({
  name: "UserAccount",
  owner
})

// Send transaction - gas paid in USDC
const { userOpHash } = await cdp.evm.sendUserOperation({
  smartAccount,
  network: "base",
  calls: [{
    to: "0xRecipient...",
    value: 0n,
    data: "0x",
  }],
  paymasterUrl: CDP_PAYMASTER_URL,
  // Paymaster will:
  // 1. Pay gas in ETH
  // 2. Deduct equivalent USDC from user's account
})
```

### Under the Hood

The paymaster implements these methods (ERC-7677):

```solidity
// Get paymaster stub data for gas estimation
function pm_getPaymasterStubData(
  UserOperation calldata userOp,
  address entryPoint,
  bytes32 context
) external returns (bytes memory paymasterData);

// Get final paymaster data for execution
function pm_getPaymasterData(
  UserOperation calldata userOp,
  address entryPoint,
  bytes32 context
) external returns (bytes memory paymasterData);

// List accepted payment tokens
function pm_getAcceptedPaymentTokens(
  address entryPoint
) external returns (address[] memory tokens);
```

---

## Circle Paymaster

Alternative ERC-20 paymaster option:

```typescript
// No CDP account required - permissionless
const paymasterUrl = "https://paymaster.circle.com"

const { userOpHash } = await sendUserOperation({
  smartAccount,
  calls: [{...}],
  paymasterUrl,
  paymasterContext: {
    token: USDC_BASE_ADDRESS,
  }
})
```

**Pricing:**
- **10% markup** on gas cost
- Example: $0.01 gas → $0.011 total
- Active since July 1, 2025

**Networks:**
- Base mainnet
- Arbitrum mainnet

---

## Works with Both Wallet Types

### Server Wallets + Paymaster

```typescript
import { CdpClient } from "@coinbase/cdp-sdk"

const cdp = new CdpClient()

// Must use Smart Account (not EOA)
const smartAccount = await cdp.evm.getOrCreateSmartAccount({
  name: "AgentAccount",
  owner
})

// Gasless transaction
const { userOpHash } = await cdp.evm.sendUserOperation({
  smartAccount,
  network: "base",
  calls: [{...}],
  paymasterUrl: CDP_PAYMASTER_URL,  // ✅ Works
})
```

### Embedded Wallets + Paymaster

```typescript
import { useSendUserOperation } from "@coinbase/cdp-hooks"

const cdpConfig = {
  projectId: "your-project-id",
  ethereum: {
    createOnLogin: "smart"  // Must use Smart Account
  }
}

function SendGasless() {
  const { sendUserOperation } = useSendUserOperation()

  const handleSend = async () => {
    await sendUserOperation({
      calls: [{...}],
      useCdpPaymaster: true,  // ✅ Works (Base only)
    })
  }
}
```

---

## Critical Requirement: Smart Accounts Only

```
┌─────────────────────────────────────────────────────────────┐
│  Paymaster Compatibility                                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   EOA Account              Smart Account (ERC-4337)          │
│   ┌──────────────┐        ┌──────────────────┐              │
│   │ ❌ No paymaster│        │ ✅ Paymaster works │              │
│   │ User needs ETH│        │ No ETH needed    │              │
│   └──────────────┘        └──────────────────┘              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Why?** Paymasters are part of the ERC-4337 standard, which requires smart accounts.

---

## Implementing Your Own Paymaster

### Basic Paymaster Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@account-abstraction/contracts/interfaces/IPaymaster.sol";

contract MyPaymaster is IPaymaster {
    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData) {
        // Validate if you'll sponsor this transaction
        // Check allowlists, limits, etc.

        if (shouldSponsor(userOp)) {
            return ("", 0);  // 0 = valid
        } else {
            return ("", 1);  // 1 = invalid
        }
    }

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost
    ) external {
        // Optional: refund logic, accounting, etc.
    }
}
```

### Custom Logic Examples

```solidity
// Allowlist-based
function shouldSponsor(UserOperation calldata userOp) internal view returns (bool) {
    return allowedContracts[userOp.callData.to];
}

// Limit-based
function shouldSponsor(UserOperation calldata userOp) internal view returns (bool) {
    uint256 userSpent = spendTracker[userOp.sender];
    return userSpent + userOp.callGasLimit < DAILY_LIMIT;
}

// NFT-holder only
function shouldSponsor(UserOperation calldata userOp) internal view returns (bool) {
    return nftContract.balanceOf(userOp.sender) > 0;
}
```

---

## Cost Comparison

### Without Paymaster (User Pays ETH)

```
User needs:
- USDC (for transaction)
- ETH (for gas)
- Knowledge of gas, wei, etc.
```

### With Gasless Paymaster (You Pay)

```
User needs:
- Just USDC

You pay:
- ~$0.0001 per tx on Base
```

### With ERC-20 Paymaster (User Pays USDC)

```
User needs:
- Just USDC (for tx + gas)

User pays:
- Transaction amount
- Gas equivalent in USDC
- Optional: 10% fee (Circle Paymaster)
```

---

## Best Practices

### 1. Policy Controls

```typescript
// Server Wallets - use Policy Engine
{
  "rules": [{
    "operation": "signEvmTransaction",
    "action": "accept",
    "criteria": {
      "type": "evmAddress",
      "operator": "in",
      "values": ["0xAllowedContract..."]
    }
  }]
}

// Embedded Wallets - use Paymaster allowlists
// Configure in CDP Portal
```

### 2. Rate Limiting

Protect against abuse:
```typescript
// Track per-user gas usage
const userGasUsed = await trackGasUsage(userAddress)
if (userGasUsed > DAILY_LIMIT) {
  // Don't sponsor
}
```

### 3. Monitoring

```typescript
// Monitor Paymaster balance
const balance = await getPaymasterBalance()
if (balance < THRESHOLD) {
  alert("Low Paymaster balance!")
}

// Track costs
logMetric("paymaster_gas_cost", actualGasCost)
```

### 4. Fallback Strategy

```typescript
// Try Paymaster, fall back to user-pays
try {
  await sendUserOperation({ paymasterUrl })
} catch (error) {
  if (error.code === "PAYMASTER_REJECTED") {
    // Ask user to pay gas
    await sendTransaction({ from: userEOA })
  }
}
```

---

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| "Paymaster rejected" | Doesn't meet allowlist | Check contract allowlist in Portal |
| "Insufficient paymaster funds" | Paymaster out of ETH | Top up paymaster balance |
| "UserOp simulation failed" | Gas estimation wrong | Increase gas limits |
| "AA33 reverted" | postOp failed | Check paymaster postOp logic |

---

## Resources

| Resource | URL |
|----------|-----|
| CDP Paymaster Docs | https://docs.cdp.coinbase.com/paymaster/introduction/welcome |
| ERC-4337 Paymasters | https://eips.ethereum.org/EIPS/eip-4337#paymaster |
| ERC-7677 Spec | https://eips.ethereum.org/EIPS/eip-7677 |
| Circle Paymaster | https://www.circle.com/paymaster |
| Pimlico Paymaster | https://docs.pimlico.io/infra/paymaster |

---

## Quick Reference

| Question | Answer |
|----------|--------|
| Can EOA use paymaster? | ❌ No - Smart Account only |
| Can Server Wallets use paymaster? | ✅ Yes - with Smart Account |
| Can Embedded Wallets use paymaster? | ✅ Yes - with Smart Account |
| CDP Paymaster supports ERC-20? | ✅ Yes (USDC, custom) - Early Access |
| Works on all chains? | ❌ CDP Paymaster = Base only |
| Cost to sponsor a tx on Base? | ~$0.0001 (very cheap) |
| Auto-sponsored on testnet? | ✅ Yes (Base Sepolia) |
