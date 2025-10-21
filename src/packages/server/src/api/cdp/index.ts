import express from 'express';
import { logger } from '@elizaos/core';
import { CdpClient } from '@coinbase/cdp-sdk';
import type { AgentServer } from '../../index';
import { sendError, sendSuccess } from '../shared/response-utils';
import { requireAuth, type AuthenticatedRequest } from '../../utils/auth';
import { createWalletClient, http } from 'viem';
import { toAccount } from 'viem/accounts';
import {
  MAINNET_NETWORKS,
  getChainConfig,
  getViemChain,
  getRpcUrl,
  isCdpSwapSupported,
  NATIVE_TOKEN_ADDRESS,
  normalizeTokenAddress,
  UNISWAP_V3_ROUTER,
  UNISWAP_V3_QUOTER,
  WRAPPED_NATIVE_TOKEN,
  UNISWAP_POOL_FEES,
} from '../../constants/chains';

/**
 * Check if a token needs approval and approve if necessary
 */
async function ensureTokenApproval(
  walletClient: any,
  publicClient: any,
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint,
  ownerAddress: string
): Promise<void> {
  // Native token doesn't need approval
  if (tokenAddress === NATIVE_TOKEN_ADDRESS) {
    return;
  }

  // ERC20 allowance ABI
  const allowanceAbi = [
    {
      name: 'allowance',
      type: 'function',
      stateMutability: 'view',
      inputs: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' }
      ],
      outputs: [{ name: '', type: 'uint256' }]
    }
  ] as const;

  // Check current allowance
  const currentAllowance = await publicClient.readContract({
    address: tokenAddress as `0x${string}`,
    abi: allowanceAbi,
    functionName: 'allowance',
    args: [ownerAddress as `0x${string}`, spenderAddress as `0x${string}`],
  });

  // If allowance is sufficient, no need to approve
  if (currentAllowance >= amount) {
    logger.debug(`[CDP API] Token ${tokenAddress} already approved`);
    return;
  }

  logger.info(`[CDP API] Approving token ${tokenAddress} for ${spenderAddress}`);

  // ERC20 approve ABI
  const approveAbi = [
    {
      name: 'approve',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' }
      ],
      outputs: [{ name: '', type: 'bool' }]
    }
  ] as const;

  // Approve max uint256 for convenience
  const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  
  const hash = await walletClient.writeContract({
    address: tokenAddress as `0x${string}`,
    abi: approveAbi,
    functionName: 'approve',
    args: [spenderAddress as `0x${string}`, maxUint256],
  });

  // Wait for approval transaction
  await publicClient.waitForTransactionReceipt({ hash });
  logger.info(`[CDP API] Token approval successful: ${hash}`);
}

/**
 * Wrap native token (ETH -> WETH, MATIC -> WMATIC, etc.)
 */
async function wrapNativeToken(
  walletClient: any,
  publicClient: any,
  wrappedTokenAddress: string,
  amount: bigint
): Promise<string> {
  logger.info(`[CDP API] Wrapping native token: ${amount.toString()}`);
  
  const wethAbi = [
    {
      name: 'deposit',
      type: 'function',
      stateMutability: 'payable',
      inputs: [],
      outputs: []
    }
  ] as const;

  const hash = await walletClient.writeContract({
    address: wrappedTokenAddress as `0x${string}`,
    abi: wethAbi,
    functionName: 'deposit',
    value: amount,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  logger.info(`[CDP API] Native token wrapped successfully: ${hash}`);
  return hash;
}

/**
 * Unwrap native token (WETH -> ETH, WMATIC -> MATIC, etc.)
 */
async function unwrapNativeToken(
  walletClient: any,
  publicClient: any,
  wrappedTokenAddress: string,
  ownerAddress: string
): Promise<{ hash: string; amount: bigint }> {
  logger.info(`[CDP API] Unwrapping native token`);
  
  // Get wrapped token balance
  const balanceAbi = [
    {
      name: 'balanceOf',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }]
    }
  ] as const;

  const wrappedBalance = await publicClient.readContract({
    address: wrappedTokenAddress as `0x${string}`,
    abi: balanceAbi,
    functionName: 'balanceOf',
    args: [ownerAddress as `0x${string}`],
  });

  if (wrappedBalance === 0n) {
    logger.warn(`[CDP API] No wrapped tokens to unwrap`);
    return { hash: '', amount: 0n };
  }

  // Withdraw
  const wethWithdrawAbi = [
    {
      name: 'withdraw',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [{ name: 'amount', type: 'uint256' }],
      outputs: []
    }
  ] as const;

  const hash = await walletClient.writeContract({
    address: wrappedTokenAddress as `0x${string}`,
    abi: wethWithdrawAbi,
    functionName: 'withdraw',
    args: [wrappedBalance],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  logger.info(`[CDP API] Unwrapped ${wrappedBalance.toString()} to native token: ${hash}`);
  
  return { hash, amount: wrappedBalance };
}

/**
 * Get quote from Uniswap V3 Quoter
 * Tries MEDIUM, LOW, then HIGH fee tiers
 * @throws Error if no liquidity pool exists for any fee tier
 */
async function getUniswapQuote(
  publicClient: any,
  quoterAddress: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint
): Promise<{ amountOut: bigint; fee: number }> {
  const quoterAbi = [
    {
      name: 'quoteExactInputSingle',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        {
          name: 'params',
          type: 'tuple',
          components: [
            { name: 'tokenIn', type: 'address' },
            { name: 'tokenOut', type: 'address' },
            { name: 'amountIn', type: 'uint256' },
            { name: 'fee', type: 'uint24' },
            { name: 'sqrtPriceLimitX96', type: 'uint160' }
          ]
        }
      ],
      outputs: [
        { name: 'amountOut', type: 'uint256' },
        { name: 'sqrtPriceX96After', type: 'uint160' },
        { name: 'initializedTicksCrossed', type: 'uint32' },
        { name: 'gasEstimate', type: 'uint256' }
      ]
    }
  ] as const;

  const quoteParams = {
    tokenIn: tokenIn as `0x${string}`,
    tokenOut: tokenOut as `0x${string}`,
    amountIn,
    fee: UNISWAP_POOL_FEES.MEDIUM,
    sqrtPriceLimitX96: 0n,
  };

  const errors: string[] = [];

  // Try MEDIUM fee tier first
  try {
    const quoteResult = await publicClient.simulateContract({
      address: quoterAddress as `0x${string}`,
      abi: quoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [quoteParams],
    });
    const amountOut = quoteResult.result[0];
    logger.info(`[CDP API] Uniswap quote (MEDIUM fee 0.3%): ${amountOut.toString()}`);
    return { amountOut, fee: UNISWAP_POOL_FEES.MEDIUM };
  } catch (mediumError) {
    const errMsg = mediumError instanceof Error ? mediumError.message : String(mediumError);
    errors.push(`MEDIUM(0.3%): ${errMsg.substring(0, 100)}`);
    logger.debug(`[CDP API] MEDIUM fee tier failed, trying LOW`);
  }

  // Try LOW fee tier
  quoteParams.fee = UNISWAP_POOL_FEES.LOW;
  try {
    const quoteResult = await publicClient.simulateContract({
      address: quoterAddress as `0x${string}`,
      abi: quoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [quoteParams],
    });
    const amountOut = quoteResult.result[0];
    logger.info(`[CDP API] Uniswap quote (LOW fee 0.05%): ${amountOut.toString()}`);
    return { amountOut, fee: UNISWAP_POOL_FEES.LOW };
  } catch (lowError) {
    const errMsg = lowError instanceof Error ? lowError.message : String(lowError);
    errors.push(`LOW(0.05%): ${errMsg.substring(0, 100)}`);
    logger.debug(`[CDP API] LOW fee tier failed, trying HIGH`);
  }

  // Try HIGH fee tier as last resort
  quoteParams.fee = UNISWAP_POOL_FEES.HIGH;
  try {
    const quoteResult = await publicClient.simulateContract({
      address: quoterAddress as `0x${string}`,
      abi: quoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [quoteParams],
    });
    const amountOut = quoteResult.result[0];
    logger.info(`[CDP API] Uniswap quote (HIGH fee 1%): ${amountOut.toString()}`);
    return { amountOut, fee: UNISWAP_POOL_FEES.HIGH };
  } catch (highError) {
    const errMsg = highError instanceof Error ? highError.message : String(highError);
    errors.push(`HIGH(1%): ${errMsg.substring(0, 100)}`);
  }

  // All fee tiers failed - no liquidity pool exists
  logger.warn(`[CDP API] No Uniswap V3 liquidity pool found for token pair ${tokenIn} -> ${tokenOut}`);
  throw new Error(`No Uniswap V3 liquidity pool exists for this token pair. This pair is not tradeable on Uniswap V3 on this network.`);
}

/**
 * Get swap quote from 0x API v2
 */
async function get0xQuote(
  network: string,
  fromToken: string,
  toToken: string,
  fromAmount: bigint,
  takerAddress: string
): Promise<{ toAmount: string; data?: any } | null> {
  const apiKey = process.env.OX_API_KEY;
  if (!apiKey) {
    logger.debug('[CDP API] 0x API key not configured');
    return null;
  }

  try {
    // 0x uses 0xeee...eee for native token
    const normalizedFromToken = normalizeTokenAddress(fromToken);
    const normalizedToToken = normalizeTokenAddress(toToken);

    // Map network names to chain IDs
    const chainIdMap: Record<string, string> = {
      'ethereum': '1',
      'polygon': '137',
      'arbitrum': '42161',
      'optimism': '10',
      'base': '8453',
    };

    const chainId = chainIdMap[network];
    if (!chainId) {
      logger.debug(`[CDP API] 0x API not available for network: ${network}`);
      return null;
    }

    // 0x API v2 uses AllowanceHolder flow (simpler, single signature)
    const params = new URLSearchParams({
      chainId,
      sellToken: normalizedFromToken,
      buyToken: normalizedToToken,
      sellAmount: fromAmount.toString(),
      taker: takerAddress,
    });

    const url = `https://api.0x.org/swap/allowance-holder/price?${params.toString()}`;
    
    logger.info(`[CDP API] Fetching 0x v2 price quote for ${network} (chainId: ${chainId})`);
    const response = await fetch(url, {
      headers: {
        '0x-api-key': apiKey,
        '0x-version': 'v2',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`[CDP API] 0x API v2 error (${response.status}): ${errorText.substring(0, 200)}`);
      return null;
    }

    const data = await response.json();
    
    if (!data.buyAmount) {
      logger.warn('[CDP API] 0x API v2 returned no buyAmount');
      return null;
    }

    logger.info(`[CDP API] 0x v2 quote successful: ${data.buyAmount} tokens expected`);
    return {
      toAmount: data.buyAmount,
      data, // Full response for executing swap
    };
  } catch (error) {
    logger.warn('[CDP API] 0x API v2 request failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Execute swap using 0x API v2
 */
async function execute0xSwap(
  walletClient: any,
  publicClient: any,
  account: any,
  network: string,
  fromToken: string,
  toToken: string,
  fromAmount: bigint,
  slippageBps: number
): Promise<{ transactionHash: string; toAmount: string }> {
  const apiKey = process.env.OX_API_KEY;
  if (!apiKey) {
    throw new Error('0x API key not configured');
  }

  const normalizedFromToken = normalizeTokenAddress(fromToken);
  const normalizedToToken = normalizeTokenAddress(toToken);

  // Map network names to chain IDs
  const chainIdMap: Record<string, string> = {
    'ethereum': '1',
    'polygon': '137',
    'arbitrum': '42161',
    'optimism': '10',
    'base': '8453',
  };

  const chainId = chainIdMap[network];
  if (!chainId) {
    throw new Error(`0x API not available for network: ${network}`);
  }

  // Convert slippageBps to basis points for v2 API (e.g., 100 bps stays as 100)
  const slippageBps_param = slippageBps;

  // 0x API v2 uses AllowanceHolder flow with slippageBps parameter
  const params = new URLSearchParams({
    chainId,
    sellToken: normalizedFromToken,
    buyToken: normalizedToToken,
    sellAmount: fromAmount.toString(),
    taker: account.address,
    slippageBps: slippageBps_param.toString(),
  });

  const url = `https://api.0x.org/swap/allowance-holder/quote?${params.toString()}`;
  
  logger.info(`[CDP API] Fetching 0x v2 swap quote with ${slippageBps}bps slippage (chainId: ${chainId})`);
  const response = await fetch(url, {
    headers: {
      '0x-api-key': apiKey,
      '0x-version': 'v2',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`0x API v2 error (${response.status}): ${errorText.substring(0, 200)}`);
  }

  const quote = await response.json();

  if (!quote.transaction || !quote.transaction.to || !quote.transaction.data || !quote.buyAmount) {
    throw new Error('Invalid 0x API v2 response');
  }

  const tx = quote.transaction;

  // Approve token if needed (for ERC20 tokens)
  // v2 uses allowanceTarget field for the approval spender
  if (normalizedFromToken !== NATIVE_TOKEN_ADDRESS && quote.issues?.allowance) {
    const spender = quote.issues.allowance.spender || tx.to;
    await ensureTokenApproval(
      walletClient,
      publicClient,
      normalizedFromToken,
      spender,
      fromAmount,
      account.address
    );
  }

  // Execute the swap
  logger.info(`[CDP API] Executing 0x v2 swap transaction`);
  const value = normalizedFromToken === NATIVE_TOKEN_ADDRESS ? fromAmount : (tx.value ? BigInt(tx.value) : 0n);
  
  // Build transaction parameters
  // Note: We don't include gas pricing parameters (gasPrice, maxFeePerGas, etc.)
  // Let viem auto-estimate them based on the current chain
  // This prevents "Malformed unsigned EIP-1559 transaction" errors on EIP-1559 chains
  const txParams: any = {
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}`,
    value,
    chain: walletClient.chain,
  };

  // Only include gas limit if provided
  if (tx.gas) {
    txParams.gas = BigInt(tx.gas);
  }

  // Don't include gasPrice or EIP-1559 params - let viem handle it
  // 0x API may return gasPrice but it conflicts with EIP-1559 chains

  const hash = await walletClient.sendTransaction(txParams);

  await publicClient.waitForTransactionReceipt({ hash });
  logger.info(`[CDP API] 0x v2 swap successful: ${hash}`);

  return {
    transactionHash: hash,
    toAmount: quote.buyAmount,
  };
}

/**
 * Execute Uniswap V3 swap
 */
async function executeUniswapSwap(
  walletClient: any,
  publicClient: any,
  account: any,
  network: string,
  fromToken: string,
  toToken: string,
  fromAmount: bigint,
  slippageBps: number
): Promise<{ transactionHash: string; toAmount: string }> {
  const routerAddress = UNISWAP_V3_ROUTER[network];
  if (!routerAddress) {
    throw new Error(`Uniswap V3 not available on network: ${network}`);
  }

  const quoterAddress = UNISWAP_V3_QUOTER[network];
  if (!quoterAddress) {
    throw new Error(`Uniswap V3 Quoter not available on network: ${network}`);
  }

  const wrappedNativeAddress = WRAPPED_NATIVE_TOKEN[network];
  if (!wrappedNativeAddress) {
    throw new Error(`Wrapped native token not configured for network: ${network}`);
  }

  // Normalize token addresses
  const normalizedFromToken = normalizeTokenAddress(fromToken);
  const normalizedToToken = normalizeTokenAddress(toToken);

  const isFromNative = normalizedFromToken === NATIVE_TOKEN_ADDRESS;
  const isToNative = normalizedToToken === NATIVE_TOKEN_ADDRESS;

  const uniswapFromToken = isFromNative ? wrappedNativeAddress : normalizedFromToken;
  const uniswapToToken = isToNative ? wrappedNativeAddress : normalizedToToken;

  logger.debug(`[CDP API] Uniswap tokens: ${uniswapFromToken} -> ${uniswapToToken}`);

  // If swapping FROM native token, wrap it first
  if (isFromNative) {
    await wrapNativeToken(walletClient, publicClient, wrappedNativeAddress, fromAmount);
  }

  // Approve token if needed
  await ensureTokenApproval(
    walletClient,
    publicClient,
    uniswapFromToken,
    routerAddress,
    fromAmount,
    account.address
  );

  // Get quote for slippage calculation
  logger.info(`[CDP API] Getting Uniswap quote for slippage calculation`);
  const { amountOut: expectedAmountOut, fee } = await getUniswapQuote(
    publicClient,
    quoterAddress,
    uniswapFromToken,
    uniswapToToken,
    fromAmount
  );

  // Calculate minimum amount out based on slippage tolerance
  const minAmountOut = (expectedAmountOut * BigInt(10000 - slippageBps)) / BigInt(10000);
  logger.info(`[CDP API] Slippage protection: expected=${expectedAmountOut.toString()}, min=${minAmountOut.toString()} (${slippageBps}bps)`);

  // Prepare and execute swap
  const swapRouterAbi = [
    {
      name: 'exactInputSingle',
      type: 'function',
      stateMutability: 'payable',
      inputs: [
        {
          name: 'params',
          type: 'tuple',
          components: [
            { name: 'tokenIn', type: 'address' },
            { name: 'tokenOut', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'recipient', type: 'address' },
            { name: 'deadline', type: 'uint256' },
            { name: 'amountIn', type: 'uint256' },
            { name: 'amountOutMinimum', type: 'uint256' },
            { name: 'sqrtPriceLimitX96', type: 'uint160' }
          ]
        }
      ],
      outputs: [{ name: 'amountOut', type: 'uint256' }]
    }
  ] as const;

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20); // 20 minutes
  const swapParams = {
    tokenIn: uniswapFromToken as `0x${string}`,
    tokenOut: uniswapToToken as `0x${string}`,
    fee,
    recipient: account.address as `0x${string}`,
    deadline,
    amountIn: fromAmount,
    amountOutMinimum: minAmountOut,
    sqrtPriceLimitX96: 0n,
  };

  const { encodeFunctionData } = await import('viem');
  const data = encodeFunctionData({
    abi: swapRouterAbi,
    functionName: 'exactInputSingle',
    args: [swapParams],
  });

  const hash = await walletClient.sendTransaction({
    to: routerAddress as `0x${string}`,
    data,
    value: 0n,
    chain: walletClient.chain,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  logger.info(`[CDP API] Uniswap V3 swap successful: ${hash}`);

  let finalAmount = expectedAmountOut.toString();

  // If swapping TO native token, unwrap it
  if (isToNative) {
    const { amount } = await unwrapNativeToken(walletClient, publicClient, wrappedNativeAddress, account.address);
    if (amount > 0n) {
      finalAmount = amount.toString();
    }
  }

  return {
    transactionHash: hash,
    toAmount: finalAmount,
  };
}

// Singleton CDP client instance
let cdpClient: CdpClient | null = null;

/**
 * Initialize CDP client with environment variables
 */
function getCdpClient(): CdpClient | null {
  if (cdpClient) {
    return cdpClient;
  }

  const apiKeyId = process.env.COINBASE_API_KEY_NAME || process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.COINBASE_PRIVATE_KEY || process.env.CDP_API_KEY_SECRET;
  const walletSecret = process.env.COINBASE_WALLET_SECRET;

  if (!apiKeyId || !apiKeySecret || !walletSecret) {
    logger.warn('[CDP API] Missing CDP credentials in environment variables');
    return null;
  }

  try {
    cdpClient = new CdpClient({
      apiKeyId,
      apiKeySecret,
      walletSecret,
    });
    logger.info('[CDP API] CDP client initialized successfully');
    return cdpClient;
  } catch (error) {
    logger.error('[CDP API] Failed to initialize CDP client:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Fetch token info (price and icon) from CoinGecko Pro API
 */
async function getTokenInfo(contractAddress: string, platform: string): Promise<{
  price: number;
  icon?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
} | null> {
  const apiKey = process.env.COINGECKO_API_KEY;
  if (!apiKey) {
    logger.warn('[CDP API] CoinGecko API key not configured');
    return null;
  }

  try {
    // Use the full coin endpoint to get price, icon, and metadata
    const url = `https://pro-api.coingecko.com/api/v3/coins/${platform}/contract/${contractAddress}`;
    const response = await fetch(url, {
      headers: {
        'x-cg-pro-api-key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        price: data.market_data?.current_price?.usd || 0,
        icon: data.image?.small, // Small icon URL
        name: data.name || undefined,
        symbol: data.symbol?.toUpperCase() || undefined,
        decimals: data.detail_platforms?.[platform]?.decimal_place || 18,
      };
    }
  } catch (err) {
    logger.warn(`[CDP API] Failed to fetch token info for ${contractAddress}:`, err instanceof Error ? err.message : String(err));
  }

  return null;
}

/**
 * Fetch token info from DexScreener
 */
async function getTokenInfoFromDexScreener(address: string, chainId: string): Promise<{
  price?: number;
  liquidity?: number;
  volume24h?: number;
  priceChange24h?: number;
  name?: string;
  symbol?: string;
} | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const pairs = data.pairs || [];
    
    // Find pair for the specific chain
    const pair = pairs.find((p: any) => p.chainId === chainId);
    
    if (!pair) {
      return null;
    }

    return {
      price: parseFloat(pair.priceUsd) || undefined,
      liquidity: parseFloat(pair.liquidity?.usd) || undefined,
      volume24h: parseFloat(pair.volume?.h24) || undefined,
      priceChange24h: parseFloat(pair.priceChange?.h24) || undefined,
      name: pair.baseToken?.name || undefined,
      symbol: pair.baseToken?.symbol || undefined,
    };
  } catch (err) {
    logger.warn(`[CDP API] DexScreener error for ${address}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Fetch native token price from CoinGecko Pro API
 */
async function getNativeTokenPrice(coingeckoId: string): Promise<number> {
  const apiKey = process.env.COINGECKO_API_KEY;
  if (!apiKey) {
    logger.warn('[CDP API] CoinGecko API key not configured');
    return 0;
  }

  try {
    const url = `https://pro-api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`;
    const response = await fetch(url, {
      headers: {
        'x-cg-pro-api-key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return data[coingeckoId]?.usd || 0;
    }
  } catch (err) {
    logger.warn(`[CDP API] Failed to fetch native token price for ${coingeckoId}:`, err instanceof Error ? err.message : String(err));
  }

  return 0;
}

/**
 * Helper function to safely convert BigInt balance to number
 */
const safeBalanceToNumber = (balanceHex: string, decimals: number): number => {
  try {
    const balance = BigInt(balanceHex);
    // Convert to string first, then do division to avoid Number overflow
    const balanceStr = balance.toString();
    const decimalPoint = balanceStr.length - decimals;
    
    if (decimalPoint <= 0) {
      // Very small number (0.00xxx)
      const zeros = '0'.repeat(Math.abs(decimalPoint));
      return parseFloat(`0.${zeros}${balanceStr}`);
    } else {
      // Normal number
      const intPart = balanceStr.slice(0, decimalPoint);
      const fracPart = balanceStr.slice(decimalPoint);
      return parseFloat(`${intPart}.${fracPart}`);
    }
  } catch (err) {
    logger.warn(`[CDP API] Error converting balance ${balanceHex} with ${decimals} decimals:`, err instanceof Error ? err.message : String(err));
    return 0;
  }
};

/**
 * Fetch wallet token balances across all networks
 */
async function fetchWalletTokens(client: CdpClient, name: string): Promise<{
  tokens: any[];
  totalUsdValue: number;
  address: string;
}> {
  logger.info(`[CDP API] Fetching token balances for user: ${name}`);

  const account = await client.evm.getOrCreateAccount({ name });
  const address = account.address;
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  
  if (!alchemyKey) {
    throw new Error('Alchemy API key not configured');
  }

  const allTokens: any[] = [];
  let totalUsdValue = 0;

  for (const network of MAINNET_NETWORKS) {
    try {
      const chainConfig = getChainConfig(network);
      if (!chainConfig) {
        logger.warn(`[CDP API] Unsupported network: ${network}`);
        continue;
      }

      const rpcUrl = chainConfig.rpcUrl(alchemyKey);

      // Step 1: Fetch native token balance
      const nativeResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBalance',
          params: [address, 'latest'],
        }),
      });

      const nativeJson = await nativeResponse.json();
      const nativeBalance = BigInt(nativeJson.result || '0');

      // Add native token if balance > 0
      if (nativeBalance > 0n) {
        const amountNum = safeBalanceToNumber('0x' + nativeBalance.toString(16), chainConfig.nativeToken.decimals);
        const usdPrice = await getNativeTokenPrice(chainConfig.nativeToken.coingeckoId);
        const usdValue = amountNum * usdPrice;
        
        // Only add to total if it's a valid number
        if (!isNaN(usdValue)) {
          totalUsdValue += usdValue;
        }

        allTokens.push({
          symbol: chainConfig.nativeToken.symbol,
          name: chainConfig.nativeToken.name,
          balance: isNaN(amountNum) ? '0' : amountNum.toString(),
          balanceFormatted: isNaN(amountNum) ? '0' : amountNum.toFixed(6).replace(/\.?0+$/, ''),
          usdValue: isNaN(usdValue) ? 0 : usdValue,
          usdPrice: isNaN(usdPrice) ? 0 : usdPrice,
          contractAddress: null,
          chain: network,
          decimals: chainConfig.nativeToken.decimals,
          icon: undefined,
        });
      }

      // Step 2: Fetch ERC20 token balances using Alchemy
      const tokensResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'alchemy_getTokenBalances',
          params: [address],
        }),
      });

      if (!tokensResponse.ok) {
        logger.warn(`[CDP API] Failed to fetch tokens for ${network}: ${tokensResponse.status}`);
        continue;
      }

      const tokensJson = await tokensResponse.json();
      if (tokensJson.error) {
        logger.warn(`[CDP API] RPC error for ${network}:`, tokensJson.error);
        continue;
      }

      const tokenBalances = tokensJson?.result?.tokenBalances || [];

      // Step 3: Process ERC20 tokens
      for (const tokenBalance of tokenBalances) {
        try {
          const contractAddress = tokenBalance.contractAddress;
          const tokenBalanceHex = tokenBalance.tokenBalance;
          
          // Skip tokens with 0 balance
          if (!tokenBalanceHex || BigInt(tokenBalanceHex) === 0n) continue;
          
          // Get token info from CoinGecko
          const platform = chainConfig.coingeckoPlatform;
          let tokenInfo = await getTokenInfo(contractAddress, platform);
          let usdPrice = 0;
          
          if (!tokenInfo) {
            // Try DexScreener as fallback
            const dexInfo = await getTokenInfoFromDexScreener(contractAddress, network);
            if (dexInfo?.price) {
              usdPrice = dexInfo.price;
              // Use DexScreener data with token metadata
              const amountNum = safeBalanceToNumber(tokenBalanceHex, 18); // Assume 18 decimals
              const usdValue = amountNum * usdPrice;
              
              // Only add to total if it's a valid number
              if (!isNaN(usdValue)) {
                totalUsdValue += usdValue;
              }
              
              allTokens.push({
                symbol: dexInfo.symbol?.toUpperCase() || 'UNKNOWN',
                name: dexInfo.name || 'Unknown Token',
                balance: isNaN(amountNum) ? '0' : amountNum.toString(),
                balanceFormatted: isNaN(amountNum) ? '0' : amountNum.toFixed(6).replace(/\.?0+$/, ''),
                usdValue: isNaN(usdValue) ? 0 : usdValue,
                usdPrice: isNaN(usdPrice) ? 0 : usdPrice,
                contractAddress,
                chain: network,
                decimals: 18,
                icon: undefined,
              });
            } else {
              logger.debug(`[CDP API] Could not get price for token ${contractAddress} on ${network}`);
            }
            continue;
          }
          
          // Use token info price, fallback to 0 if null
          usdPrice = tokenInfo.price || 0;
          
          // Convert balance using correct decimals
          const amountNum = safeBalanceToNumber(tokenBalanceHex, tokenInfo.decimals || 18);
          const usdValue = amountNum * usdPrice;
          
          // Only add to total if it's a valid number
          if (!isNaN(usdValue)) {
            totalUsdValue += usdValue;
          }
          
          allTokens.push({
            symbol: tokenInfo.symbol || 'UNKNOWN',
            name: tokenInfo.name || 'Unknown Token',
            balance: isNaN(amountNum) ? '0' : amountNum.toString(),
            balanceFormatted: isNaN(amountNum) ? '0' : amountNum.toFixed(6).replace(/\.?0+$/, ''),
            usdValue: isNaN(usdValue) ? 0 : usdValue,
            usdPrice: isNaN(usdPrice) ? 0 : usdPrice,
            contractAddress,
            chain: network,
            decimals: tokenInfo.decimals || 18,
            icon: tokenInfo.icon,
          });
        } catch (err) {
          logger.warn(`[CDP API] Error processing token ${tokenBalance.contractAddress} on ${network}:`, err instanceof Error ? err.message : String(err));
        }
      }
    } catch (err) {
      logger.warn(`[CDP API] Failed to fetch balances for ${network}:`, err instanceof Error ? err.message : String(err));
    }
  }

  // Ensure totalUsdValue is a valid number
  const finalTotalUsdValue = isNaN(totalUsdValue) ? 0 : totalUsdValue;
  
  logger.info(`[CDP API] Found ${allTokens.length} tokens for user ${name}, total value: $${finalTotalUsdValue.toFixed(2)}`);

  return {
    tokens: allTokens,
    totalUsdValue: finalTotalUsdValue,
    address: account.address,
  };
}

/**
 * Fetch wallet NFTs across all networks
 */
async function fetchWalletNFTs(client: CdpClient, name: string): Promise<{
  nfts: any[];
  address: string;
}> {
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyKey) {
    throw new Error('Alchemy API key not configured');
  }

  logger.info(`[CDP API] Fetching NFTs for user: ${name}`);

  const account = await client.evm.getOrCreateAccount({ name });
  const address = account.address;

  // Fetch NFTs from all mainnet networks using Alchemy REST API
  const networks = MAINNET_NETWORKS.map(network => {
    const config = getChainConfig(network);
    const baseUrl = config?.rpcUrl(alchemyKey).replace('/v2/', '/nft/v3/');
    return {
      name: network,
      url: `${baseUrl}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=100`
    };
  });

  const allNfts: any[] = [];

  for (const network of networks) {
    try {
      const response = await fetch(network.url);
      
      if (!response.ok) {
        logger.warn(`[CDP API] Failed to fetch NFTs for ${network.name}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const nfts = data.ownedNfts || [];

      for (const nft of nfts) {
        const metadata = nft.raw?.metadata || {};
        const tokenId = nft.tokenId;
        const contractAddress = nft.contract?.address;
        
        // Get image URL and handle IPFS
        let imageUrl = metadata.image || nft.image?.cachedUrl || nft.image?.originalUrl || nft.image?.thumbnailUrl || '';
        if (imageUrl && imageUrl.startsWith('ipfs://')) {
          imageUrl = imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
        }

        allNfts.push({
          chain: network.name,
          contractAddress,
          tokenId,
          name: metadata.name || nft.name || `${nft.contract?.name || 'Unknown'} #${tokenId}`,
          description: metadata.description || nft.description || '',
          image: imageUrl,
          contractName: nft.contract?.name || nft.contract?.symbol || 'Unknown Collection',
          tokenType: nft.contract?.tokenType || 'ERC721',
          balance: nft.balance, // For ERC1155
          attributes: metadata.attributes || [], // NFT attributes/traits
        });
      }
    } catch (err) {
      logger.warn(`[CDP API] Error fetching NFTs for ${network.name}:`, err instanceof Error ? err.message : String(err));
    }
  }

  logger.info(`[CDP API] Found ${allNfts.length} NFTs for user ${name}`);

  return {
    nfts: allNfts,
    address,
  };
}


export function cdpRouter(_serverInstance: AgentServer): express.Router {
  const router = express.Router();

  // SECURITY: Require authentication for all CDP wallet operations
  // This ensures users can only access their own wallets
  router.use(requireAuth);

  // Cache for wallet tokens and NFTs
  interface CacheEntry<T> {
    data: T;
    timestamp: number;
  }

  const tokensCache = new Map<string, CacheEntry<any>>();
  const nftsCache = new Map<string, CacheEntry<any>>();
  const CACHE_TTL = 300 * 1000;

  /**
   * POST /api/cdp/wallet
   * Get or create server wallet for authenticated user
   * SECURITY: Uses userId from JWT token, not from request body
   */
  router.post('/wallet', async (req: AuthenticatedRequest, res) => {
    try {
      // SECURITY: Use userId from authenticated token, NOT from request body
      const userId = req.userId!;

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized. Check environment variables.');
      }

      logger.info(`[CDP API] Getting/creating wallet for authenticated user: ${userId.substring(0, 8)}...`);

      const account = await client.evm.getOrCreateAccount({ name: userId });
      const address = account.address;

      logger.info(`[CDP API] Wallet ready: ${address}`);

      sendSuccess(res, {
        address,
        accountName: userId,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error with wallet:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'WALLET_FAILED',
        'Failed to get/create wallet',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * GET /api/cdp/wallet/tokens
   * Get token balances for authenticated user (checks cache first)
   * SECURITY: Uses authenticated userId from JWT token
   */
  router.get('/wallet/tokens', async (req: AuthenticatedRequest, res) => {
    try {
      // SECURITY: Use authenticated userId from JWT token
      const userId = req.userId!;

      // Check cache first
      const cached = tokensCache.get(userId);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        logger.info(`[CDP API] Returning cached token balances for user: ${userId.substring(0, 8)}...`);
        return sendSuccess(res, { ...cached.data, fromCache: true });
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      // Fetch fresh data
      const result = await fetchWalletTokens(client, userId);

      // Update cache
      tokensCache.set(userId, {
        data: result,
        timestamp: Date.now(),
      });

      sendSuccess(res, { ...result, fromCache: false });
    } catch (error) {
      logger.error(
        '[CDP API] Error fetching tokens:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'FETCH_TOKENS_FAILED',
        'Failed to fetch token balances',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * POST /api/cdp/wallet/tokens/sync
   * Force sync token balances for authenticated user (bypasses cache)
   * SECURITY: Uses authenticated userId from JWT token
   */
  router.post('/wallet/tokens/sync', async (req: AuthenticatedRequest, res) => {
    try {
      // SECURITY: Use authenticated userId from JWT token
      const userId = req.userId!;

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Force syncing token balances for user: ${userId.substring(0, 8)}...`);

      // Fetch fresh data
      const result = await fetchWalletTokens(client, userId);

      // Update cache
      tokensCache.set(userId, {
        data: result,
        timestamp: Date.now(),
      });

      sendSuccess(res, { ...result, synced: true });
    } catch (error) {
      logger.error(
        '[CDP API] Error syncing tokens:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SYNC_TOKENS_FAILED',
        'Failed to sync token balances',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * GET /api/cdp/wallet/nfts
   * Get NFT holdings for authenticated user (checks cache first)
   * SECURITY: Uses authenticated userId from JWT token
   */
  router.get('/wallet/nfts', async (req: AuthenticatedRequest, res) => {
    try {
      // SECURITY: Use authenticated userId from JWT token
      const userId = req.userId!;

      // Check cache first
      const cached = nftsCache.get(userId);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        logger.info(`[CDP API] Returning cached NFTs for user: ${userId.substring(0, 8)}...`);
        return sendSuccess(res, { ...cached.data, fromCache: true });
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      // Fetch fresh data
      const result = await fetchWalletNFTs(client, userId);

      // Update cache
      nftsCache.set(userId, {
        data: result,
        timestamp: Date.now(),
      });

      sendSuccess(res, { ...result, fromCache: false });
    } catch (error) {
      logger.error(
        '[CDP API] Error fetching NFTs:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'FETCH_NFTS_FAILED',
        'Failed to fetch NFTs',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * POST /api/cdp/wallet/nfts/sync
   * Force sync NFTs for authenticated user (bypasses cache)
   * SECURITY: Uses authenticated userId from JWT token
   */
  router.post('/wallet/nfts/sync', async (req: AuthenticatedRequest, res) => {
    try {
      // SECURITY: Use authenticated userId from JWT token
      const userId = req.userId!;

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Force syncing NFTs for user: ${userId.substring(0, 8)}...`);

      // Fetch fresh data
      const result = await fetchWalletNFTs(client, userId);

      // Update cache
      nftsCache.set(userId, {
        data: result,
        timestamp: Date.now(),
      });

      sendSuccess(res, { ...result, synced: true });
    } catch (error) {
      logger.error(
        '[CDP API] Error syncing NFTs:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SYNC_NFTS_FAILED',
        'Failed to sync NFTs',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * GET /api/cdp/wallet/history
   * Get transaction history for authenticated user across networks using Alchemy API
   * SECURITY: Uses authenticated userId from JWT token
   */
  router.get('/wallet/history', async (req: AuthenticatedRequest, res) => {
    try {
      // SECURITY: Use authenticated userId from JWT token
      const userId = req.userId!;

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      const alchemyKey = process.env.ALCHEMY_API_KEY;
      if (!alchemyKey) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Alchemy API key not configured');
      }

      logger.info(`[CDP API] Fetching transaction history for user: ${userId.substring(0, 8)}...`);

      const account = await client.evm.getOrCreateAccount({ name: userId });
      const address = account.address;

      // Fetch transactions from all mainnet networks
      const networks = MAINNET_NETWORKS.map(network => {
        const config = getChainConfig(network);
        return {
          name: network,
          rpc: config?.rpcUrl(alchemyKey) || '',
          explorer: config?.explorerUrl || '',
        };
      }).filter(n => n.rpc && n.explorer);

      const allTransactions: any[] = [];

      for (const network of networks) {
        try {
          // Fetch sent transactions (fromAddress)
          const sentResponse = await fetch(network.rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'alchemy_getAssetTransfers',
              params: [{
                fromAddress: address,
                category: ['external', 'erc20', 'erc721', 'erc1155'],
                maxCount: '0x19', // 25 transactions
                withMetadata: true,
                excludeZeroValue: false,
              }],
            }),
          });

          // Fetch received transactions (toAddress)
          const receivedResponse = await fetch(network.rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'alchemy_getAssetTransfers',
              params: [{
                toAddress: address,
                category: ['external', 'erc20', 'erc721', 'erc1155'],
                maxCount: '0x19', // 25 transactions
                withMetadata: true,
                excludeZeroValue: false,
              }],
            }),
          });

          if (sentResponse.ok) {
            const sentData = await sentResponse.json();
            if (sentData.error) {
              logger.warn(`[CDP API] ${network.name} sent transactions error:`, sentData.error);
            } else {
              const sentTransfers = sentData?.result?.transfers || [];
              for (const tx of sentTransfers) {
                const timestamp = tx.metadata?.blockTimestamp ? new Date(tx.metadata.blockTimestamp).getTime() : Date.now();
                allTransactions.push({
                  chain: network.name,
                  hash: tx.hash,
                  from: tx.from,
                  to: tx.to,
                  value: tx.value?.toString() || '0',
                  asset: tx.asset || 'ETH',
                  category: tx.category,
                  timestamp,
                  blockNum: tx.blockNum,
                  explorerUrl: `${network.explorer}/tx/${tx.hash}`,
                  direction: 'sent',
                });
              }
            }
          } else {
            logger.warn(`[CDP API] ${network.name} sent transactions: HTTP ${sentResponse.status}`);
          }

          if (receivedResponse.ok) {
            const receivedData = await receivedResponse.json();
            if (receivedData.error) {
              logger.warn(`[CDP API] ${network.name} received transactions error:`, receivedData.error);
            } else {
              const receivedTransfers = receivedData?.result?.transfers || [];
              for (const tx of receivedTransfers) {
                const timestamp = tx.metadata?.blockTimestamp ? new Date(tx.metadata.blockTimestamp).getTime() : Date.now();
                allTransactions.push({
                  chain: network.name,
                  hash: tx.hash,
                  from: tx.from,
                  to: tx.to,
                  value: tx.value?.toString() || '0',
                  asset: tx.asset || 'ETH',
                  category: tx.category,
                  timestamp,
                  blockNum: tx.blockNum,
                  explorerUrl: `${network.explorer}/tx/${tx.hash}`,
                  direction: 'received',
                });
              }
            }
          } else {
            logger.warn(`[CDP API] ${network.name} received transactions: HTTP ${receivedResponse.status}`);
          }
        } catch (err) {
          logger.warn(`[CDP API] Error fetching history for ${network.name}:`, err instanceof Error ? err.message : String(err));
        }
      }

      // Sort by timestamp descending (most recent first)
      allTransactions.sort((a, b) => b.timestamp - a.timestamp);

      logger.info(`[CDP API] Found ${allTransactions.length} transactions for user ${userId.substring(0, 8)}...`);

      sendSuccess(res, {
        transactions: allTransactions,
        address,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error fetching history:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'FETCH_HISTORY_FAILED',
        'Failed to fetch transaction history',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * POST /api/cdp/wallet/send
   * Send tokens from authenticated user's server wallet
   * SECURITY: Uses userId from JWT token, not from request body
   */
  router.post('/wallet/send', async (req: AuthenticatedRequest, res) => {
    try {
      // SECURITY: Use authenticated userId, NOT from request body
      const userId = req.userId!;
      const { network, to, token, amount } = req.body;

      if (!network || !to || !token || !amount) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: network, to, token, amount');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Authenticated user ${userId.substring(0, 8)}... sending ${amount} ${token} to ${to} on ${network}`);

      // Try CDP SDK first
      let cdpSuccess = false;
      let transactionHash: string | undefined;
      let fromAddress: string;

      try {
        logger.info(`[CDP API] Attempting transfer with CDP SDK...`);
        const account = await client.evm.getOrCreateAccount({ name: userId });
        const networkAccount = await account.useNetwork(network);
        fromAddress = account.address;

        // Convert amount to bigint (assuming it's already in base units with decimals)
        const amountBigInt = BigInt(amount);

        const result = await networkAccount.transfer({
          to: to as `0x${string}`,
          amount: amountBigInt,
          token: token as any,
        });

        if (result.transactionHash) {
          transactionHash = result.transactionHash;
          cdpSuccess = true;
          logger.info(`[CDP API] CDP SDK transfer successful: ${transactionHash}`);
        }
      } catch (cdpError) {
        logger.warn(
          `[CDP API] CDP SDK transfer failed, trying viem fallback:`,
          cdpError instanceof Error ? cdpError.message : String(cdpError)
        );

        // Fallback to viem
        logger.info(`[CDP API] Using viem fallback for transfer...`);
        
        const chain = getViemChain(network);
        if (!chain) {
          throw new Error(`Unsupported network: ${network}`);
        }

        // Get wallet from CDP (using authenticated userId)
        const account = await client.evm.getOrCreateAccount({ name: userId });
        fromAddress = account.address;

        // Get Alchemy key for RPC
        const alchemyKey = process.env.ALCHEMY_API_KEY;
        if (!alchemyKey) {
          throw new Error('Alchemy API key not configured');
        }

        const rpcUrl = getRpcUrl(network, alchemyKey);
        if (!rpcUrl) {
          throw new Error(`Could not get RPC URL for network: ${network}`);
        }

        // Create wallet client
        const walletClient = createWalletClient({
          account: toAccount(account),
          chain,
          transport: http(rpcUrl),
        });

        const amountBigInt = BigInt(amount);

        // Check if it's a native token or ERC20
        const isNativeToken = !token.startsWith('0x');
        
        if (isNativeToken) {
          // Native token transfer (ETH, MATIC, etc.)
          logger.info(`[CDP API] Sending native token via viem...`);
          const hash = await walletClient.sendTransaction({
            chain,
            to: to as `0x${string}`,
            value: amountBigInt,
          });
          transactionHash = hash;
        } else {
          // ERC20 token transfer
          logger.info(`[CDP API] Sending ERC20 token ${token} via viem...`);
          
          // ERC20 transfer function
          const hash = await walletClient.writeContract({
            chain,
            address: token as `0x${string}`,
            abi: [
              {
                name: 'transfer',
                type: 'function',
                stateMutability: 'nonpayable',
                inputs: [
                  { name: 'to', type: 'address' },
                  { name: 'amount', type: 'uint256' }
                ],
                outputs: [{ name: '', type: 'bool' }]
              }
            ] as const,
            functionName: 'transfer',
            args: [to as `0x${string}`, amountBigInt],
          });
          transactionHash = hash;
        }

        logger.info(`[CDP API] Viem transfer successful: ${transactionHash}`);
      }

      if (!transactionHash) {
        throw new Error('Transfer did not return a transaction hash');
      }

      sendSuccess(res, {
        transactionHash,
        from: fromAddress!,
        to,
        amount: amount.toString(),
        token,
        network,
        method: cdpSuccess ? 'cdp-sdk' : 'viem-fallback',
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error sending tokens:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SEND_FAILED',
        'Failed to send tokens',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * POST /api/cdp/wallet/send-nft
   * Send NFT from authenticated user's server wallet
   * SECURITY: Uses userId from JWT token, not from request body
   */
  router.post('/wallet/send-nft', async (req: AuthenticatedRequest, res) => {
    try {
      // SECURITY: Use authenticated userId, NOT from request body
      const userId = req.userId!;
      const { network, to, contractAddress, tokenId } = req.body;

      if (!network || !to || !contractAddress || !tokenId) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: network, to, contractAddress, tokenId');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Authenticated user ${userId.substring(0, 8)}... sending NFT ${contractAddress}:${tokenId} to ${to} on ${network}`);

      const account = await client.evm.getOrCreateAccount({ name: userId });
      
      // Use viem to send the NFT transaction
      const { createWalletClient, createPublicClient, http } = await import('viem');
      const { toAccount } = await import('viem/accounts');
      
      const chain = getViemChain(network);
      if (!chain) {
        return sendError(res, 400, 'INVALID_NETWORK', `Unsupported network: ${network}`);
      }
      
      const alchemyKey = process.env.ALCHEMY_API_KEY;
      if (!alchemyKey) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Alchemy API key not configured');
      }
      
      const rpcUrl = getRpcUrl(network, alchemyKey);
      if (!rpcUrl) {
        return sendError(res, 400, 'INVALID_NETWORK', `Could not get RPC URL for network: ${network}`);
      }
      
      const walletClient = createWalletClient({
        account: toAccount(account),
        chain,
        transport: http(rpcUrl),
      });
      
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });

      // ERC721 safeTransferFrom ABI
      const erc721Abi = [
        {
          name: 'safeTransferFrom',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'tokenId', type: 'uint256' }
          ],
          outputs: []
        }
      ] as const;

      const txHash = await walletClient.writeContract({
        address: contractAddress as `0x${string}`,
        abi: erc721Abi,
        functionName: 'safeTransferFrom',
        args: [account.address as `0x${string}`, to as `0x${string}`, BigInt(tokenId)],
        chain,
      });

      // Wait for transaction confirmation
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      logger.info(`[CDP API] NFT transfer successful: ${txHash}`);

      sendSuccess(res, {
        transactionHash: txHash,
        from: account.address,
        to,
        contractAddress,
        tokenId,
        network,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error sending NFT:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SEND_NFT_FAILED',
        'Failed to send NFT',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * POST /api/cdp/wallet/swap-price
   * Get swap price estimate for authenticated user
   * SECURITY: Uses userId from JWT token, not from request body
   */
  router.post('/wallet/swap-price', async (req: AuthenticatedRequest, res) => {
    try {
      // SECURITY: Use authenticated userId, NOT from request body
      const userId = req.userId!;
      const { network, fromToken, toToken, fromAmount } = req.body;

      if (!network || !fromToken || !toToken || !fromAmount) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: network, fromToken, toToken, fromAmount');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Getting swap price for authenticated user ${userId.substring(0, 8)}...: ${fromAmount} ${fromToken} to ${toToken} on ${network}`);

      const account = await client.evm.getOrCreateAccount({ name: userId });

      // Normalize token addresses (convert native token symbols to NATIVE_TOKEN_ADDRESS)
      const normalizedFromToken = normalizeTokenAddress(fromToken);
      const normalizedToToken = normalizeTokenAddress(toToken);

      logger.debug(`[CDP API] Normalized tokens: ${normalizedFromToken} -> ${normalizedToToken}`);

      let swapPriceResult;

      // Check if CDP SDK supports swaps on this network
      if (isCdpSwapSupported(network)) {
        logger.info(`[CDP API] Using CDP SDK for swap price on ${network}`);
        
        // Use CDP SDK
        const swapPrice = await client.evm.getSwapPrice({
          fromToken: normalizedFromToken as `0x${string}`,
          toToken: normalizedToToken as `0x${string}`,
          fromAmount: BigInt(fromAmount),
          network: network,
          taker: account.address,
        });

        swapPriceResult = {
          liquidityAvailable: swapPrice.liquidityAvailable,
          toAmount: (swapPrice as any).toAmount?.toString() || '0',
          minToAmount: (swapPrice as any).minToAmount?.toString() || '0',
        };
      } else {
        // Non-CDP networks: Try 0x API first, then fall back to Uniswap V3
        logger.info(`[CDP API] Using 0x API / Uniswap V3 for price estimation on ${network}`);
        
        // Try 0x API first
        const zeroXQuote = await get0xQuote(network, fromToken, toToken, BigInt(fromAmount), account.address);
        
        if (zeroXQuote) {
          logger.info(`[CDP API] Using 0x API quote`);
          swapPriceResult = {
            liquidityAvailable: true,
            toAmount: zeroXQuote.toAmount,
            minToAmount: zeroXQuote.toAmount, // Will be calculated with actual slippage during swap
          };
        } else {
          // Fall back to Uniswap V3
          logger.info(`[CDP API] 0x API unavailable, falling back to Uniswap V3`);
        
        const quoterAddress = UNISWAP_V3_QUOTER[network];
        if (!quoterAddress) {
          logger.warn(`[CDP API] Uniswap V3 Quoter not available for ${network}`);
          swapPriceResult = {
            liquidityAvailable: false,
            toAmount: '0',
            minToAmount: '0',
          };
        } else {
          const chain = getViemChain(network);
          if (!chain) {
            throw new Error(`Unsupported network: ${network}`);
          }

          const alchemyKey = process.env.ALCHEMY_API_KEY;
          if (!alchemyKey) {
            throw new Error('Alchemy API key not configured');
          }

          const rpcUrl = getRpcUrl(network, alchemyKey);
          if (!rpcUrl) {
            throw new Error(`Could not get RPC URL for network: ${network}`);
          }

          const { createPublicClient } = await import('viem');

          const publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl),
          });

          // Convert native token addresses to wrapped tokens for Uniswap V3
          const wrappedNativeAddress = WRAPPED_NATIVE_TOKEN[network];
          if (!wrappedNativeAddress) {
            throw new Error(`Wrapped native token not configured for network: ${network}`);
          }

          const isFromNative = normalizedFromToken === NATIVE_TOKEN_ADDRESS;
          const isToNative = normalizedToToken === NATIVE_TOKEN_ADDRESS;

          const uniswapFromToken = isFromNative ? wrappedNativeAddress : normalizedFromToken;
          const uniswapToToken = isToNative ? wrappedNativeAddress : normalizedToToken;

            try {
              const { amountOut } = await getUniswapQuote(
                publicClient,
                quoterAddress,
                uniswapFromToken,
                uniswapToToken,
                BigInt(fromAmount)
              );
              
              const toAmountStr = amountOut.toString();
            swapPriceResult = {
              liquidityAvailable: true,
              toAmount: toAmountStr,
              minToAmount: toAmountStr, // Will be calculated with actual slippage during swap
            };
            } catch (quoteError) {
              logger.warn(`[CDP API] Failed to get Uniswap quote:`, quoteError instanceof Error ? quoteError.message : String(quoteError));
            swapPriceResult = {
              liquidityAvailable: false,
              toAmount: '0',
              minToAmount: '0',
            };
            }
          }
        }
      }

      logger.info(`[CDP API] Swap price retrieved. Liquidity available: ${swapPriceResult.liquidityAvailable}`);

      sendSuccess(res, {
        liquidityAvailable: swapPriceResult.liquidityAvailable,
        toAmount: swapPriceResult.toAmount,
        minToAmount: swapPriceResult.minToAmount,
        fromAmount: fromAmount,
        fromToken,
        toToken,
        network,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error getting swap price:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SWAP_PRICE_FAILED',
        'Failed to get swap price',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * POST /api/cdp/wallet/swap
   * Execute token swap for authenticated user (CDP SDK with viem fallback, or Uniswap V3)
   * SECURITY: Uses userId from JWT token, not from request body
   */
  router.post('/wallet/swap', async (req: AuthenticatedRequest, res) => {
    try {
      // SECURITY: Use authenticated userId, NOT from request body
      const userId = req.userId!;
      const { network, fromToken, toToken, fromAmount, slippageBps } = req.body;

      if (!network || !fromToken || !toToken || !fromAmount || slippageBps === undefined) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: network, fromToken, toToken, fromAmount, slippageBps');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Authenticated user ${userId.substring(0, 8)}... executing swap: ${fromAmount} ${fromToken} to ${toToken} on ${network}`);

      const account = await client.evm.getOrCreateAccount({ name: userId });
      
      // Normalize token addresses (convert native token symbols to NATIVE_TOKEN_ADDRESS)
      const normalizedFromToken = normalizeTokenAddress(fromToken);
      const normalizedToToken = normalizeTokenAddress(toToken);

      logger.debug(`[CDP API] Normalized tokens: ${normalizedFromToken} -> ${normalizedToToken}`);

      let transactionHash: string | undefined;
      let method: string = 'unknown';
      let toAmount: string = '0';

      // Check if CDP SDK supports swaps on this network
      if (isCdpSwapSupported(network)) {
        // Try CDP SDK swap first
        try {
          logger.info(`[CDP API] Attempting swap with CDP SDK...`);
          
          const networkAccount = await account.useNetwork(network);
          
          // Execute swap using CDP SDK
          const swapResult = await (networkAccount as any).swap({
            fromToken: normalizedFromToken as `0x${string}`,
            toToken: normalizedToToken as `0x${string}`,
            fromAmount: BigInt(fromAmount),
            slippageBps: slippageBps,
          });

          transactionHash = swapResult.transactionHash;
          toAmount = swapResult.toAmount?.toString() || '0';
          method = 'cdp-sdk';
          
          logger.info(`[CDP API] CDP SDK swap successful: ${transactionHash}`);
        } catch (cdpError) {
          logger.warn(
            `[CDP API] CDP SDK swap failed, trying viem fallback:`,
            cdpError instanceof Error ? cdpError.message : String(cdpError)
          );

          // Fallback to viem with CDP quote
          logger.info(`[CDP API] Using viem fallback for swap...`);

          const chain = getViemChain(network);
          if (!chain) {
            throw new Error(`Unsupported network: ${network}`);
          }

          const alchemyKey = process.env.ALCHEMY_API_KEY;
          if (!alchemyKey) {
            throw new Error('Alchemy API key not configured');
          }

          const rpcUrl = getRpcUrl(network, alchemyKey);
          if (!rpcUrl) {
            throw new Error(`Could not get RPC URL for network: ${network}`);
          }

          // Get swap quote first
          const networkAccount = await account.useNetwork(network);
          const swapQuote = await (networkAccount as any).quoteSwap({
            fromToken: normalizedFromToken as `0x${string}`,
            toToken: normalizedToToken as `0x${string}`,
            fromAmount: BigInt(fromAmount),
            slippageBps: slippageBps,
            network: network,
          });

          if (!swapQuote.liquidityAvailable) {
            throw new Error('Insufficient liquidity for swap');
          }

          toAmount = swapQuote.toAmount?.toString() || '0';

          // Execute the swap using viem with the quote data
          const { createWalletClient, createPublicClient } = await import('viem');
          const { toAccount } = await import('viem/accounts');

          const walletClient = createWalletClient({
            account: toAccount(account),
            chain,
            transport: http(rpcUrl),
          });

          const publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl),
          });

          // Get the transaction data from the quote
          const txData = swapQuote.transaction;
          
          if (!txData || !txData.to || !txData.data) {
            throw new Error('Invalid transaction data from swap quote');
          }

          // Send the transaction
          const hash = await walletClient.sendTransaction({
            to: txData.to as `0x${string}`,
            data: txData.data as `0x${string}`,
            value: txData.value ? BigInt(txData.value) : 0n,
            chain,
          });

          // Wait for confirmation
          await publicClient.waitForTransactionReceipt({ hash });

          transactionHash = hash;
          method = 'viem-cdp-fallback';
          logger.info(`[CDP API] Viem swap successful: ${transactionHash}`);
        }
      } else {
        // Non-CDP networks: Try 0x API first, then fall back to Uniswap V3
        logger.info(`[CDP API] Using 0x API / Uniswap V3 for swap on ${network}`);

        const chain = getViemChain(network);
        if (!chain) {
          throw new Error(`Unsupported network: ${network}`);
        }

        const alchemyKey = process.env.ALCHEMY_API_KEY;
        if (!alchemyKey) {
          throw new Error('Alchemy API key not configured');
        }

        const rpcUrl = getRpcUrl(network, alchemyKey);
        if (!rpcUrl) {
          throw new Error(`Could not get RPC URL for network: ${network}`);
        }

        const { createWalletClient, createPublicClient } = await import('viem');
        const { toAccount } = await import('viem/accounts');

        const walletClient = createWalletClient({
          account: toAccount(account),
          chain,
          transport: http(rpcUrl),
        });

        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        });

        // Try 0x API first
        try {
          logger.info(`[CDP API] Attempting swap with 0x API...`);
          const result = await execute0xSwap(
            walletClient,
            publicClient,
            account,
            network,
            fromToken,
            toToken,
            BigInt(fromAmount),
            slippageBps
          );

          transactionHash = result.transactionHash;
          toAmount = result.toAmount;
          method = '0x-api';
          logger.info(`[CDP API] 0x API swap successful`);
        } catch (zeroXError) {
          logger.warn(
            `[CDP API] 0x API swap failed, falling back to Uniswap V3:`,
            zeroXError instanceof Error ? zeroXError.message : String(zeroXError)
          );

          // Fall back to Uniswap V3
          logger.info(`[CDP API] Using Uniswap V3 fallback for swap`);
          const result = await executeUniswapSwap(
          walletClient,
          publicClient,
            account,
            network,
            fromToken,
            toToken,
          BigInt(fromAmount),
            slippageBps
          );

          transactionHash = result.transactionHash;
          toAmount = result.toAmount;
          method = 'uniswap-v3-viem';
        }
      }

      if (!transactionHash) {
        throw new Error('Swap did not return a transaction hash');
      }

      sendSuccess(res, {
        transactionHash,
        from: account.address,
        fromToken,
        toToken,
        fromAmount: fromAmount.toString(),
        toAmount,
        network,
        method,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error executing swap:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SWAP_FAILED',
        'Failed to execute swap',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * Search for tokens using CoinGecko API directly
   */
  router.get('/tokens/search', async (req, res) => {
    try {
      const { query, chain } = req.query;

      if (!query || typeof query !== 'string' || query.length < 2) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Query parameter is required (min 2 characters)');
      }

      const apiKey = process.env.COINGECKO_API_KEY;
      const isPro = Boolean(apiKey);
      const baseUrl = isPro ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';

      logger.info(`[CDP API] Searching tokens: "${query}" on chain: ${chain || 'all'}`);

      // Map chain names to CoinGecko platform IDs
      const networkToPlatformId: Record<string, string> = {
        'ethereum': 'ethereum',
        'base': 'base',
        'polygon': 'polygon-pos',
        'arbitrum': 'arbitrum-one',
        'optimism': 'optimistic-ethereum',
      };

      const chainIdToNetwork: Record<string, string> = {
        'ethereum': 'ethereum',
        'base': 'base',
        'polygon-pos': 'polygon',
        'arbitrum-one': 'arbitrum',
        'optimistic-ethereum': 'optimism',
      };

      let tokens: any[] = [];

      // Check if query is a contract address
      const isAddress = /^0x[a-fA-F0-9]{40}$/.test(query);

      if (isAddress) {
        // Search by contract address
        const platforms = chain && typeof chain === 'string' 
          ? [networkToPlatformId[chain.toLowerCase()]] 
          : ['ethereum', 'base', 'polygon-pos', 'arbitrum-one', 'optimistic-ethereum'];

        for (const platformId of platforms) {
          if (!platformId) continue;
          
          try {
            const url = `${baseUrl}/coins/${platformId}/contract/${query}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(url, {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                ...(isPro && apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
                'User-Agent': 'Otaku-CDP-Wallet/1.0',
              },
              signal: controller.signal,
            });

            clearTimeout(timeout);

            if (response.ok) {
              const data = await response.json();
              const currentPrice = data.market_data?.current_price?.usd || null;

              tokens.push({
                id: data.id,
                symbol: data.symbol?.toUpperCase() || 'UNKNOWN',
                name: data.name || 'Unknown Token',
                contractAddress: query,
                chain: chainIdToNetwork[platformId] || platformId,
                icon: data.image?.small || data.image?.thumb || null,
                price: currentPrice,
                platforms: data.platforms || {},
              });
              break; // Found it, no need to check other chains
            }
          } catch (error) {
            logger.debug(`[CDP API] Contract search failed on ${platformId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        // Search by symbol or name using search endpoint
        const searchUrl = `${baseUrl}/search?query=${encodeURIComponent(query)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
          const response = await fetch(searchUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              ...(isPro && apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
              'User-Agent': 'Otaku-CDP-Wallet/1.0',
            },
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (!response.ok) {
            throw new Error(`CoinGecko search failed: ${response.status}`);
          }

          const searchData = await response.json();
          const coins = searchData.coins || [];

          // Get detailed info for top results (limit to 10 for performance)
          const topCoins = coins.slice(0, 10);
          
          for (const coin of topCoins) {
            try {
              const detailUrl = `${baseUrl}/coins/${coin.id}`;
              const detailController = new AbortController();
              const detailTimeout = setTimeout(() => detailController.abort(), 5000);

              const detailResponse = await fetch(detailUrl, {
                method: 'GET',
                headers: {
                  'Accept': 'application/json',
                  ...(isPro && apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
                  'User-Agent': 'Otaku-CDP-Wallet/1.0',
                },
                signal: detailController.signal,
              });

              clearTimeout(detailTimeout);

              if (detailResponse.ok) {
                const data = await detailResponse.json();
                const platforms = data.platforms || {};
                const currentPrice = data.market_data?.current_price?.usd || null;

                // Find contract address for the requested chain or any supported chain
                let contractAddress: string | null = null;
                let tokenChain: string | null = null;

                if (chain && typeof chain === 'string') {
                  const platformId = networkToPlatformId[chain.toLowerCase()];
                  if (platformId && platforms[platformId]) {
                    contractAddress = platforms[platformId];
                    tokenChain = chain.toLowerCase();
                  }
                } else {
                  // Get first available supported chain
                  for (const [platformId, address] of Object.entries(platforms)) {
                    if (chainIdToNetwork[platformId] && address) {
                      contractAddress = address as string;
                      tokenChain = chainIdToNetwork[platformId];
                      break;
                    }
                  }
                }

                if (contractAddress && tokenChain) {
                  tokens.push({
                    id: data.id,
                    symbol: data.symbol?.toUpperCase() || 'UNKNOWN',
                    name: data.name || 'Unknown Token',
                    contractAddress,
                    chain: tokenChain,
                    icon: data.image?.small || data.image?.thumb || null,
                    price: currentPrice,
                    platforms: data.platforms || {},
                  });
                }
              }
            } catch (error) {
              logger.debug(`[CDP API] Failed to fetch details for ${coin.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } catch (error) {
          logger.error(`[CDP API] CoinGecko search failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      logger.info(`[CDP API] Found ${tokens.length} tokens matching "${query}"`);

      return sendSuccess(res, { tokens });
    } catch (error) {
      logger.error(
        '[CDP API] Error searching tokens:',
        error instanceof Error ? error.message : String(error)
      );
      return sendError(
        res,
        500,
        'SEARCH_FAILED',
        'Failed to search tokens',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return router;
}
