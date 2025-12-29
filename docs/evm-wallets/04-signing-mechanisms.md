# Signing Mechanisms: From EOA to Smart Accounts

> Understanding how different wallet types sign transactions

---

## Traditional EOA Signing

### How It Works

```
Private Key (secp256k1)
     │
     ├── Signs transaction hash
     │
     ▼
┌─────────────────────────────────────────┐
│  Signature (65 bytes)                    │
│  - r (32 bytes)                          │
│  - s (32 bytes)                          │
│  - v (1 byte)                            │
└─────────────────────────────────────────┘
     │
     ▼
ecrecover(hash, v, r, s) → address
```

### Key Characteristics

| Aspect | Details |
|--------|---------|
| Curve | secp256k1 (Bitcoin/Ethereum) |
| Key storage | User's device/browser extension |
| Verification | ecrecover on-chain |
| Flexibility | Fixed (one key = one address) |

### Example

```typescript
import { privateKeyToAccount } from "viem/accounts"

const account = privateKeyToAccount("0x...")

// Sign transaction
const signature = await account.signTransaction({
  to: "0x...",
  value: parseEther("1"),
  nonce: 0,
})

// Anyone can verify:
// ecrecover(txHash, v, r, s) === account.address
```

---

## Smart Account Signing (ERC-4337)

### The Problem

Smart accounts are **contracts**, not EOAs. They don't have private keys.

### The Solution

```
EOA Owner (signs)  ──►  UserOperation  ──►  Smart Account (validates + executes)
```

### Signing Flow

```
1. EOA signs UserOperation hash
        │
        ▼
2. Signature included in UserOperation
        │
        ▼
3. EntryPoint calls smartAccount.validateUserOp()
        │
        ▼
4. Smart account checks: "Is signer authorized?"
        │
        ▼
5. If yes: execute calls
   If no: revert
```

### Code Example

```typescript
import { toSimpleSmartAccount } from "permissionless/accounts"

// EOA owner
const owner = privateKeyToAccount("0x...")

// Smart account controlled by owner
const smartAccount = await toSimpleSmartAccount({
  client: publicClient,
  owner,  // This EOA can sign on behalf of smart account
  entryPoint: entryPoint07Address,
})

// Owner signs UserOperation (not transaction)
const userOpHash = await smartAccount.sendTransaction({
  to: "0x...",
  value: parseEther("1"),
})
```

### Signature Structure

```typescript
// UserOperation.signature contains:
{
  ownerIndex: 0,  // Which owner signed (smart accounts can have multiple)
  signatureData: "0x..."  // The actual signature
}
```

---

## Passkey Signing (WebAuthn)

### What are Passkeys?

Device-based cryptographic keys using **secp256r1** (not secp256k1).

```
User Device
     │
     ├── Face ID / Touch ID / Windows Hello
     │
     ▼
┌─────────────────────────────────────────┐
│  Passkey (secp256r1)                     │
│  - Stored in device secure enclave       │
│  - Biometric protected                   │
│  - Bound to domain (e.g., keys.coinbase.com) │
└─────────────────────────────────────────┘
```

### Signing Flow

```
1. Smart account needs signature
        │
        ▼
2. WebAuthn API called
        │
        ▼
3. User authenticates (Face ID)
        │
        ▼
4. Device signs with secp256r1 key
        │
        ▼
5. Smart account verifies via EIP-1271
```

### Coinbase Smart Wallet Example

```typescript
// User creates passkey on keys.coinbase.com
// Passkey becomes owner of smart account

// When signing:
const userOp = {
  // ... user operation data
  signature: {
    ownerIndex: 0,  // Which passkey
    signatureData: {
      authenticatorData: "0x...",
      clientDataJSON: "0x...",
      challengeIndex: 23,
      typeIndex: 1,
      r: "0x...",
      s: "0x...",
    }
  }
}

// Smart account validates using WebAuthn verifier
```

### Key Differences: secp256k1 vs secp256r1

| Aspect | secp256k1 (Ethereum) | secp256r1 (Passkeys) |
|--------|----------------------|---------------------|
| Used by | Bitcoin, Ethereum EOAs | Apple, Google, WebAuthn |
| Verification | ecrecover (cheap) | Custom verifier (expensive) |
| Browser support | No | Yes (WebAuthn API) |
| Hardware support | Limited | Wide (secure enclaves) |

---

## CDP Signing: TEE-based

### Architecture

```
┌─────────────────────────────────────────┐
│  AWS Nitro Enclave (TEE)                 │
├─────────────────────────────────────────┤
│                                          │
│  1. Receive signing request              │
│  2. Verify Wallet Secret                 │
│  3. Decrypt private key                  │
│  4. Sign transaction                     │
│  5. Return signature                     │
│  6. Key never leaves TEE                 │
│                                          │
└─────────────────────────────────────────┘
```

### Server Wallets

```typescript
// Developer's Wallet Secret authenticates to TEE
const cdp = new CdpClient({
  apiKeyId: "...",
  apiKeySecret: "...",
  walletSecret: "..."  // Unlocks signing in TEE
})

// Signing happens automatically in TEE
const tx = await cdp.evm.sendTransaction({
  account,
  to: "0x...",
  value: parseEther("1"),
})

// Developer never sees private key
```

### Embedded Wallets

```typescript
// User's session authenticates to TEE
// After login, user's device has Temporary Wallet Secret

// Signing happens automatically
<SendEvmTransactionButton
  to="0x..."
  value="0.1"
  // No popup - signs in TEE
/>
```

### Security Properties

| Property | Details |
|----------|---------|
| Key location | TEE memory only |
| Encrypted at rest | Yes (with Wallet Secret) |
| Export possible | Yes (for backup) |
| Coinbase access | No (even with subpoena) |
| User access | Via authenticated API only |

---

## Signature Verification: EIP-1271

### The Problem

Smart accounts can't use `ecrecover` because they're contracts.

### The Solution: EIP-1271

```solidity
interface IERC1271 {
  function isValidSignature(
    bytes32 hash,
    bytes memory signature
  ) external view returns (bytes4 magicValue);
}
```

### How It Works

```
1. Someone wants to verify a signature
        │
        ▼
2. Call smartAccount.isValidSignature(hash, signature)
        │
        ▼
3. Smart account checks:
   - Is signature from authorized owner?
   - Is it a valid passkey signature?
   - Does it pass custom logic?
        │
        ▼
4. Return 0x1626ba7e (valid) or anything else (invalid)
```

### Example

```solidity
contract MySmartAccount {
    address public owner;

    function isValidSignature(
        bytes32 hash,
        bytes memory signature
    ) external view returns (bytes4) {
        // Recover signer from signature
        address signer = recover(hash, signature);

        // Check if signer is authorized
        if (signer == owner) {
            return 0x1626ba7e;  // EIP-1271 magic value
        }

        return 0xffffffff;  // Invalid
    }
}
```

### Passkey Verification

```solidity
function isValidSignature(
    bytes32 hash,
    bytes memory signature
) external view returns (bytes4) {
    // Decode WebAuthn signature
    WebAuthnAuth memory auth = abi.decode(signature, (WebAuthnAuth));

    // Verify secp256r1 signature
    bool valid = WebAuthn.verify({
        challenge: hash,
        requireUV: false,
        webAuthnAuth: auth,
        x: owners[ownerIndex].x,
        y: owners[ownerIndex].y
    });

    return valid ? 0x1626ba7e : 0xffffffff;
}
```

---

## Owner Types Comparison

### Coinbase Smart Wallet Owners

```typescript
// Owners are stored as bytes (flexible)
bytes[] public owners;

// Can be:
// 1. Ethereum address (20 bytes)
owners[0] = abi.encode(0x1234...);

// 2. Passkey public key (64 bytes)
owners[1] = abi.encode(x: 0x..., y: 0x...);
```

### Multiple Owners

```typescript
// Smart accounts can have multiple owners
const smartAccount = {
  owners: [
    "0x123...",  // EOA
    { x: "0x...", y: "0x..." },  // Passkey
    "0x456...",  // Another EOA
  ]
}

// Any owner can sign transactions
```

---

## Signing Latency Comparison

| Method | Latency | Notes |
|--------|---------|-------|
| EOA (MetaMask) | User dependent | Requires popup |
| CDP TEE | < 200ms | Fully automated |
| Passkey | 1-3s | Biometric confirmation |
| Hardware wallet | 5-10s | Physical confirmation |

---

## Session Keys

Smart accounts can create **temporary signing keys** with limited permissions.

### Concept

```
Main Owner (passkey)
     │
     ├── Creates session key (EOA)
     │
     ▼
┌─────────────────────────────────────────┐
│  Session Key                             │
│  - Valid for 24 hours                    │
│  - Can only call whitelisted contracts   │
│  - Max $100 per transaction              │
└─────────────────────────────────────────┘
```

### Example

```typescript
// Create session key
const sessionKey = generatePrivateKey()

// Register it on smart account
await smartAccount.addSessionKey({
  key: sessionKey.address,
  validUntil: Date.now() + 86400000,  // 24 hours
  allowedContracts: ["0xGameContract..."],
  spendLimit: parseEther("100"),
})

// Game can now sign on behalf of user (no popup)
const signature = await sessionKey.signUserOp(gameAction)
```

---

## Security Considerations

### EOA

| Risk | Mitigation |
|------|------------|
| Key theft | Hardware wallet |
| Phishing | Verify contract addresses |
| Lost key | Backup seed phrase |

### Smart Account + Passkey

| Risk | Mitigation |
|------|------------|
| Passkey lost | Add recovery signer |
| Device stolen | Biometric required |
| Domain hijack | Verify keys.coinbase.com |

### CDP TEE

| Risk | Mitigation |
|------|------------|
| API key theft | Rotate keys, Policy Engine |
| Excessive signing | Rate limits, policies |
| Unauthorized access | 2FA on Portal |

---

## Quick Reference

| Wallet Type | Signing Method | Curve | Verification |
|-------------|---------------|-------|--------------|
| **EOA** | Private key | secp256k1 | ecrecover |
| **Smart Account (EOA owner)** | EOA signs UserOp | secp256k1 | EIP-1271 → ecrecover |
| **Smart Account (Passkey)** | WebAuthn | secp256r1 | EIP-1271 → WebAuthn verifier |
| **CDP Server Wallet** | TEE | secp256k1 | Standard (EOA) or EIP-1271 (Smart) |
| **CDP Embedded Wallet** | TEE | secp256k1 | Standard (EOA) or EIP-1271 (Smart) |

---

## Resources

| Resource | URL |
|----------|-----|
| EIP-1271 Spec | https://eips.ethereum.org/EIPS/eip-1271 |
| WebAuthn Spec | https://w3c.github.io/webauthn/ |
| secp256r1 Verifier | https://github.com/base-org/webauthn-sol |
| ERC-4337 Signatures | https://eips.ethereum.org/EIPS/eip-4337#signature-aggregation |
| Coinbase Smart Wallet | https://github.com/coinbase/smart-wallet |
