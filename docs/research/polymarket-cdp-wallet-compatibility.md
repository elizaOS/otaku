# Research Report: Polymarket CLOB Client + CDP Wallet Integration

Generated: 2025-12-29

## Executive Summary

**Integration is technically feasible but requires a custom adapter.** The Polymarket CLOB client expects an ethers.js v5 `Wallet` or `JsonRpcSigner` with a `_signTypedData` method, while CDP wallets natively support viem's `signTypedData`. A thin adapter layer can bridge these interfaces since both follow EIP-712 signing standards. The key constraint is that CDP accounts already implement `signTypedData` in a viem-compatible format, and the signature formats between ethers v5 and viem are identical for EIP-712.

## Research Question

Can Polymarket's CLOB client work with Coinbase Developer Platform (CDP) server wallets instead of raw private keys?

## Key Findings

### Finding 1: Polymarket CLOB Client Signer Requirements

The CLOB client (`@polymarket/clob-client`) expects signers from ethers.js v5:

```typescript
// From src/client.ts
readonly signer?: Wallet | JsonRpcSigner;

// Constructor accepts a getSigner callback for dynamic resolution
getSigner?: () => Promise<Wallet | JsonRpcSigner> | (Wallet | JsonRpcSigner)
```

**Critical signing method**: The client uses `signer._signTypedData(domain, types, value)` for EIP-712 signing.

Example from `src/signing/eip712.ts`:
```typescript
// EIP-712 domain for CLOB authentication
const domain = {
  name: "ClobAuthDomain",
  version: "1",
  chainId: chainId
};

// eslint-disable-next-line no-underscore-dangle
const sig = await signer._signTypedData(domain, types, value);
```

- Source: [Polymarket CLOB Client GitHub](https://github.com/Polymarket/clob-client)

### Finding 2: CDP Server Wallet Signing Capabilities

CDP wallets fully support EIP-712 typed data signing via the `signTypedData` method:

From `/Users/studio/Documents/GitHub/otaku/node_modules/@coinbase/cdp-sdk/accounts/evm/toEvmServerAccount.ts`:

```typescript
async signTypedData<
  const typedData extends TypedData | Record<string, unknown>,
  primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
>(parameters: TypedDataDefinition<typedData, primaryType>) {
  // ... creates EIP-712 compatible message
  const result = await apiClient.signEvmTypedData(options.account.address, openApiMessage);
  return result.signature as Hex;
}
```

Key capabilities:
- **signMessage**: Sign arbitrary messages
- **signTransaction**: Sign serialized transactions
- **signTypedData**: Full EIP-712 typed data signing (viem-compatible format)
- **sign**: Sign raw hashes

CDP wallets are MPC-based, non-custodial, and keys are secured in TEEs (Trusted Execution Environments).

- Source: [CDP SDK TypeScript Docs](https://coinbase.github.io/cdp-sdk/typescript/)
- Source: [CDP EIP-712 Signing Docs](https://docs.cdp.coinbase.com/server-wallets/v2/evm-features/eip-712-signing)

### Finding 3: Otaku's Existing CDP Integration Pattern

The current CDP integration uses viem's `toAccount()` to wrap CDP accounts:

From `/Users/studio/Documents/GitHub/otaku/src/managers/cdp-transaction-manager.ts`:

```typescript
import { toAccount } from 'viem/accounts';

// toAccount() allows viem to use CDP's server-managed wallet signing
const walletClient = createWalletClient({
  account: toAccount(account),
  chain,
  transport: http(resolvedRpcUrl),
});
```

The `CdpTransactionManager` is a singleton that handles:
- Account creation/retrieval via `client.evm.getOrCreateAccount({ name: userId })`
- Viem client construction for any supported network
- Token transfers, swaps, NFT transfers

Networks supported: `ethereum`, `base`, `optimism`, `arbitrum`, `polygon`, `base-sepolia`

**Polygon support is confirmed** - this is important since Polymarket operates on Polygon.

### Finding 4: Interface Compatibility Analysis

**Signature format is identical**: Both ethers.js v5 and viem produce the same hex signature format for EIP-712.

**Method signature differences**:

| Aspect | ethers.js v5 | viem/CDP SDK |
|--------|--------------|--------------|
| Method name | `_signTypedData()` | `signTypedData()` |
| Parameters | `(domain, types, value)` | `{ domain, types, primaryType, message }` |
| Address getter | `getAddress()` | `.address` property |
| Return type | `Promise<string>` | `Promise<Hex>` |

The parameters are structurally equivalent, just organized differently.

### Finding 5: Adapter Implementation Requirements

To bridge CDP wallets to CLOB client, we need an adapter that:

1. Implements ethers.js v5 `Wallet` or `JsonRpcSigner` interface
2. Wraps CDP account's `signTypedData` method
3. Provides `getAddress()` method
4. Handles parameter format conversion

Example adapter pattern:

```typescript
import { Wallet } from '@ethersproject/wallet';

class CdpSignerAdapter {
  private cdpAccount: EvmServerAccount;

  constructor(cdpAccount: EvmServerAccount) {
    this.cdpAccount = cdpAccount;
  }

  get address(): string {
    return this.cdpAccount.address;
  }

  async getAddress(): Promise<string> {
    return this.cdpAccount.address;
  }

  // Bridge ethers v5 _signTypedData to CDP signTypedData
  async _signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, any>
  ): Promise<string> {
    // Get primary type (first non-EIP712Domain type)
    const primaryType = Object.keys(types).find(t => t !== 'EIP712Domain')!;

    const signature = await this.cdpAccount.signTypedData({
      domain,
      types,
      primaryType,
      message: value,
    });

    return signature;
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    return this.cdpAccount.signMessage({ message: message.toString() });
  }
}
```

## Codebase Analysis

### Current State

1. **No existing Polymarket plugin** - `grep` found no references to "polymarket", "CLOB", or "prediction"
2. **CDP integration is mature** - `CdpTransactionManager` is a production-ready singleton
3. **Polygon network is supported** - Listed in `CdpNetwork` type

### Relevant Files

| File | Purpose |
|------|---------|
| `/Users/studio/Documents/GitHub/otaku/src/managers/cdp-transaction-manager.ts` | CDP wallet operations, viem integration |
| `/Users/studio/Documents/GitHub/otaku/src/plugins/plugin-cdp/services/cdp.service.ts` | ElizaOS service wrapper for CDP manager |
| `/Users/studio/Documents/GitHub/otaku/src/plugins/plugin-cdp/types.ts` | Network type definitions |

### Dependencies

Current CDP SDK version: `@coinbase/cdp-sdk": "1.38.6"`

The CHANGELOG confirms `signTypedData` was added in version 1.19.0 (PR #284) with viem compatibility fixes in 1.17.1 (PR #211).

## Integration Architecture

```
                                    +----------------------+
                                    |  Polymarket CLOB     |
                                    |  Client              |
                                    +----------+-----------+
                                               |
                                               | expects ethers.js v5
                                               | Wallet / JsonRpcSigner
                                               v
                                    +----------------------+
                                    |  CdpSignerAdapter    |
                                    |  (new component)     |
                                    +----------+-----------+
                                               |
                                               | wraps CDP account
                                               | adapts interface
                                               v
                         +---------------------------------------------+
                         |                                             |
            +------------v-------------+              +----------------v---------+
            | CDP EvmServerAccount     |              | CdpTransactionManager    |
            | (from cdp-sdk)           |<------------>| (existing singleton)     |
            +--------------------------+              +--------------------------+
                         |                                             |
                         | signTypedData                               | getOrCreateAccount
                         v                                             v
                    +----------------------+                 +------------------+
                    | CDP Backend (TEE)    |                 | CDP API          |
                    | Secure key storage   |                 +------------------+
                    +----------------------+
```

## Recommendations

### Implementation Plan

1. **Create `CdpSignerAdapter` class** in `src/plugins/plugin-polymarket/adapters/`
   - Implements minimal ethers v5 Signer interface
   - Wraps CDP account for `_signTypedData`, `signMessage`, `getAddress`

2. **Create Polymarket plugin** following Otaku patterns
   - Service: `PolymarketService` extending ElizaOS `Service`
   - Actions: place order, get markets, check positions
   - Use existing `CdpTransactionManager` for wallet access

3. **Network Configuration**
   - Polymarket operates on Polygon (chainId: 137)
   - CDP already supports Polygon network

### Example Integration Code

```typescript
// src/plugins/plugin-polymarket/adapters/cdp-signer-adapter.ts
import { CdpTransactionManager } from '@/managers/cdp-transaction-manager';

export async function getCdpSignerForPolymarket(
  accountName: string
): Promise<CdpSignerAdapter> {
  const manager = CdpTransactionManager.getInstance();
  const cdpClient = manager.getCdpClient();
  const account = await cdpClient.evm.getOrCreateAccount({ name: accountName });

  return new CdpSignerAdapter(account);
}

// src/plugins/plugin-polymarket/services/polymarket.service.ts
import { ClobClient } from '@polymarket/clob-client';

export class PolymarketService extends Service {
  private clobClient: ClobClient | null = null;

  async initializeClient(accountName: string): Promise<void> {
    const signer = await getCdpSignerForPolymarket(accountName);

    this.clobClient = new ClobClient(
      'https://clob.polymarket.com',
      137, // Polygon chainId
      signer,
      undefined, // creds - derived later
      0, // EOA signature type
      signer.address // funder address
    );
  }
}
```

### Security Considerations

1. **No private key exposure** - CDP wallets never expose keys
2. **MPC signing** - Keys secured in Trusted Execution Environments
3. **Audit trail** - CDP provides logging of all signing operations
4. **Policy support** - Can add signing policies via CDP SDK

### Performance Implications

1. **Network latency** - CDP signing requires API call to Coinbase (adds ~100-300ms)
2. **Caching** - Can cache CDP account lookups (already done in `CdpTransactionManager`)
3. **Rate limits** - Check CDP API rate limits for high-frequency trading

### Limitations

1. **No raw private key access** - Cannot export keys from CDP
2. **API dependency** - Signing requires CDP API availability
3. **Signature type** - Only EOA signatures (signatureType: 0) supported initially

## Sources

- [Polymarket CLOB Client GitHub](https://github.com/Polymarket/clob-client)
- [CDP SDK npm package](https://www.npmjs.com/package/@coinbase/cdp-sdk)
- [CDP EIP-712 Documentation](https://docs.cdp.coinbase.com/server-wallets/v2/evm-features/eip-712-signing)
- [CDP viem Compatibility](https://docs.cdp.coinbase.com/wallet-api/v2/evm-features/viem-compatibility)
- [CDP SDK TypeScript Docs](https://coinbase.github.io/cdp-sdk/typescript/)
- [Wagmi Ethers Adapters](https://wagmi.sh/core/guides/ethers)
- [Viem signTypedData](https://viem.sh/docs/actions/wallet/signTypedData.html)
- [Ethers v5 to Viem Migration](https://viem.sh/docs/ethers-migration)

## Open Questions

1. **CLOB API credentials** - How will `createOrDeriveApiKey()` work with CDP wallets? May need to derive L2 API keys using the CDP signer.

2. **Order signing** - Need to verify order signing (EIP-712 for limit/market orders) uses the same interface as authentication.

3. **Transaction broadcasting** - Does CLOB client broadcast transactions, or does it only sign? If it broadcasts, need to ensure Polygon RPC compatibility.

4. **Rate limiting** - What are CDP API signing rate limits? Important for active trading.

5. **Funder address** - Polymarket uses a "funder" address for USDC. Need to verify this can be the CDP wallet address.
