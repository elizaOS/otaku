import { logger } from "@elizaos/core";
import type { PublicClient, WalletClient } from "viem";
import type { EvmServerAccount } from "@coinbase/cdp-sdk";
import {
  NATIVE_TOKEN_ADDRESS,
  normalizeTokenAddress,
  UNISWAP_V3_ROUTER,
  UNISWAP_V3_QUOTER,
  WRAPPED_NATIVE_TOKEN,
  UNISWAP_POOL_FEES,
  isCdpSwapSupported,
} from "../constants/chains";
import { TX_CONFIRMATION_TIMEOUT, waitForTxConfirmation } from "../constants/timeouts";
import type { CdpNetwork } from "../types";

/**
 * Check if a token needs approval and approve if necessary
 */
export async function ensureTokenApproval(
  walletClient: WalletClient,
  publicClient: PublicClient,
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
    logger.debug(`[Swap Utils] Token ${tokenAddress} already approved`);
    return;
  }

  logger.info(`[Swap Utils] Approving token ${tokenAddress} for ${spenderAddress}`);

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
    account: walletClient.account!,
    address: tokenAddress as `0x${string}`,
    abi: approveAbi,
    functionName: 'approve',
    args: [spenderAddress as `0x${string}`, maxUint256],
    chain: walletClient.chain,
  });

  // Wait for approval transaction
  await publicClient.waitForTransactionReceipt({ hash });
  logger.info(`[Swap Utils] Token approval successful: ${hash}`);
}

/**
 * Wrap native token (ETH -> WETH, MATIC -> WMATIC, etc.)
 */
export async function wrapNativeToken(
  walletClient: WalletClient,
  publicClient: PublicClient,
  wrappedTokenAddress: string,
  amount: bigint
): Promise<string> {
  logger.info(`[Swap Utils] Wrapping native token: ${amount.toString()}`);
  
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
    account: walletClient.account!,
    address: wrappedTokenAddress as `0x${string}`,
    abi: wethAbi,
    functionName: 'deposit',
    value: amount,
    chain: walletClient.chain,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  logger.info(`[Swap Utils] Native token wrapped successfully: ${hash}`);
  return hash;
}

/**
 * Get quote from Uniswap V3 Quoter
 * Tries MEDIUM, LOW, then HIGH fee tiers
 */
export async function getUniswapQuote(
  publicClient: PublicClient,
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

  // Try MEDIUM fee tier first
  try {
    const quoteResult = await publicClient.simulateContract({
      address: quoterAddress as `0x${string}`,
      abi: quoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [quoteParams],
    });
    const amountOut = quoteResult.result[0];
    logger.info(`[Swap Utils] Uniswap quote (MEDIUM fee 0.3%): ${amountOut.toString()}`);
    return { amountOut, fee: UNISWAP_POOL_FEES.MEDIUM };
  } catch (mediumError) {
    logger.debug(`[Swap Utils] MEDIUM fee tier failed, trying LOW`);
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
    logger.info(`[Swap Utils] Uniswap quote (LOW fee 0.05%): ${amountOut.toString()}`);
    return { amountOut, fee: UNISWAP_POOL_FEES.LOW };
  } catch (lowError) {
    logger.debug(`[Swap Utils] LOW fee tier failed, trying HIGH`);
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
    logger.info(`[Swap Utils] Uniswap quote (HIGH fee 1%): ${amountOut.toString()}`);
    return { amountOut, fee: UNISWAP_POOL_FEES.HIGH };
  } catch (highError) {
    // All fee tiers failed
    logger.warn(`[Swap Utils] No Uniswap V3 liquidity pool found`);
    throw new Error(`No Uniswap V3 liquidity pool exists for this token pair.`);
  }
}

/**
 * Get swap quote from 0x API v2
 */
export async function get0xQuote(
  network: string,
  fromToken: string,
  toToken: string,
  fromAmount: bigint,
  takerAddress: string
): Promise<{ toAmount: string } | null> {
  const apiKey = process.env.OX_API_KEY;
  if (!apiKey) {
    logger.debug('[Swap Utils] 0x API key not configured');
    return null;
  }

  try {
    const normalizedFromToken = normalizeTokenAddress(fromToken);
    const normalizedToToken = normalizeTokenAddress(toToken);

    const chainIdMap: Record<string, string> = {
      'ethereum': '1',
      'polygon': '137',
      'arbitrum': '42161',
      'optimism': '10',
      'base': '8453',
    };

    const chainId = chainIdMap[network];
    if (!chainId) {
      logger.debug(`[Swap Utils] 0x API not available for network: ${network}`);
      return null;
    }

    const params = new URLSearchParams({
      chainId,
      sellToken: normalizedFromToken,
      buyToken: normalizedToToken,
      sellAmount: fromAmount.toString(),
      taker: takerAddress,
    });

    const url = `https://api.0x.org/swap/allowance-holder/price?${params.toString()}`;
    
    logger.info(`[Swap Utils] Fetching 0x v2 price quote for ${network}`);
    const response = await fetch(url, {
      headers: {
        '0x-api-key': apiKey,
        '0x-version': 'v2',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`[Swap Utils] 0x API v2 error (${response.status}): ${errorText.substring(0, 200)}`);
      return null;
    }

    const data = await response.json();
    
    if (!data.buyAmount) {
      logger.warn('[Swap Utils] 0x API v2 returned no buyAmount');
      return null;
    }

    logger.info(`[Swap Utils] 0x v2 quote successful: ${data.buyAmount} tokens expected`);
    return { toAmount: data.buyAmount };
  } catch (error) {
    logger.warn('[Swap Utils] 0x API v2 request failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Execute swap using 0x API v2
 */
export async function execute0xSwap(
  walletClient: WalletClient,
  publicClient: PublicClient,
  account: EvmServerAccount,
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

  const params = new URLSearchParams({
    chainId,
    sellToken: normalizedFromToken,
    buyToken: normalizedToToken,
    sellAmount: fromAmount.toString(),
    taker: account.address,
    slippageBps: slippageBps.toString(),
  });

  const url = `https://api.0x.org/swap/allowance-holder/quote?${params.toString()}`;
  
  logger.info(`[Swap Utils] Fetching 0x v2 swap quote with ${slippageBps}bps slippage`);
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
  logger.info(`[Swap Utils] Executing 0x v2 swap transaction`);
  const value = normalizedFromToken === NATIVE_TOKEN_ADDRESS ? fromAmount : (tx.value ? BigInt(tx.value) : 0n);
  
  const txParams: any = {
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}`,
    value,
    chain: walletClient.chain,
  };

  if (tx.gas) {
    txParams.gas = BigInt(tx.gas);
  }

  const hash = await walletClient.sendTransaction(txParams);

  await waitForTxConfirmation(publicClient, hash, "0x swap");

  return {
    transactionHash: hash,
    toAmount: quote.buyAmount,
  };
}

/**
 * Execute Uniswap V3 swap
 */
export async function executeUniswapSwap(
  walletClient: WalletClient,
  publicClient: PublicClient,
  account: EvmServerAccount,
  network: string,
  fromToken: string,
  toToken: string,
  fromAmount: bigint,
  slippageBps: number
): Promise<{ transactionHash: string }> {
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

  const normalizedFromToken = normalizeTokenAddress(fromToken);
  const normalizedToToken = normalizeTokenAddress(toToken);

  const isFromNative = normalizedFromToken === NATIVE_TOKEN_ADDRESS;
  const isToNative = normalizedToToken === NATIVE_TOKEN_ADDRESS;

  const uniswapFromToken = isFromNative ? wrappedNativeAddress : normalizedFromToken;
  const uniswapToToken = isToNative ? wrappedNativeAddress : normalizedToToken;

  logger.debug(`[Swap Utils] Uniswap tokens: ${uniswapFromToken} -> ${uniswapToToken}`);

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
  logger.info(`[Swap Utils] Getting Uniswap quote for slippage calculation`);
  const { amountOut: expectedAmountOut, fee } = await getUniswapQuote(
    publicClient,
    quoterAddress,
    uniswapFromToken,
    uniswapToToken,
    fromAmount
  );

  // Calculate minimum amount out based on slippage tolerance
  const minAmountOut = (expectedAmountOut * BigInt(10000 - slippageBps)) / BigInt(10000);
  logger.info(`[Swap Utils] Slippage protection: expected=${expectedAmountOut.toString()}, min=${minAmountOut.toString()}`);

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
    account: walletClient.account!,
    to: routerAddress as `0x${string}`,
    data,
    value: 0n,
    chain: walletClient.chain,
  });

  await waitForTxConfirmation(publicClient, hash, "Uniswap swap");

  return {
    transactionHash: hash,
  };
}

/**
 * Execute CDP SDK swap with Permit2 approval handling
 */
export async function executeCdpSwap(
  account: EvmServerAccount,
  accountName: string,
  network: CdpNetwork,
  fromToken: `0x${string}`,
  toToken: `0x${string}`,
  fromAmount: bigint,
  slippageBps: number,
  getViemClients: (accountName: string, network: CdpNetwork) => Promise<{
    walletClient: WalletClient;
    publicClient: PublicClient;
  }>
): Promise<{ transactionHash: string }> {
  const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`;
  
  try {
    // Try swap first - CDP SDK will check approvals
    logger.info("[Swap Utils] Attempting CDP SDK swap...");
    const swapResult = await account.swap({
      network,
      fromToken,
      toToken,
      fromAmount,
      slippageBps,
    });

    if (!swapResult.transactionHash) {
      throw new Error('Swap did not return a transaction hash');
    }

    logger.info(`[Swap Utils] CDP SDK swap transaction submitted: ${swapResult.transactionHash}`);
    
    // Wait for transaction confirmation
    const { publicClient } = await getViemClients(accountName, network);
    await waitForTxConfirmation(publicClient, swapResult.transactionHash as `0x${string}`, "swap");
    return {
      transactionHash: swapResult.transactionHash,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Check for insufficient gas/balance
    if (errorMessage.includes("gas required exceeds allowance") || errorMessage.includes("insufficient funds")) {
      throw new Error(`Insufficient ETH balance to pay for transaction gas fees. Please fund your wallet with ETH first.`);
    }
    
    // Handle Permit2 approval
    if (errorMessage.includes("allowance") && errorMessage.includes("Permit2")) {
      logger.info("[Swap Utils] Token approval needed for Permit2, approving now...");
      
      // Get viem clients for the account
      const { walletClient, publicClient } = await getViemClients(accountName, network);
      
      const approveAbi = [{
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" }
        ],
        outputs: [{ type: "bool" }]
      }] as const;
      
      logger.info("[Swap Utils] Sending Permit2 approval transaction...");
      const approvalHash = await walletClient.writeContract({
        address: fromToken,
        abi: approveAbi,
        functionName: "approve",
        args: [
          PERMIT2_ADDRESS,
          BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
        ],
        chain: walletClient.chain,
      } as any);
      
      logger.info(`[Swap Utils] Permit2 approval sent: ${approvalHash}`);
      
      logger.info("[Swap Utils] Waiting for approval confirmation...");
      const receipt = await publicClient.waitForTransactionReceipt({ 
        hash: approvalHash,
        timeout: 20_000,
      });
      logger.info(`[Swap Utils] Approval confirmed in block ${receipt.blockNumber}`);
      
      logger.info("[Swap Utils] Waiting 8 seconds for CDP SDK nonce cache to sync...");
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      logger.info("[Swap Utils] Retrying CDP SDK swap after approval...");
      const swapResult = await account.swap({
        network,
        fromToken,
        toToken,
        fromAmount,
        slippageBps,
      });

      if (!swapResult.transactionHash) {
        throw new Error('Swap execution did not return a transaction hash');
      }

      logger.info(`[Swap Utils] CDP SDK swap successful after approval: ${swapResult.transactionHash}`);
      return {
        transactionHash: swapResult.transactionHash,
      };
    }
    
    // Re-throw if not an approval error
    throw error;
  }
}

/**
 * Main swap function with automatic fallback to multiple swap providers
 * 
 * Fallback chain:
 * 1. CDP SDK (for supported networks) with Permit2 approval handling
 * 2. 0x API v2 (if configured)
 * 3. Uniswap V3 (direct protocol interaction)
 */
export async function executeSwap(params: {
  account: EvmServerAccount;
  accountName: string;
  network: CdpNetwork;
  fromToken: `0x${string}`;
  toToken: `0x${string}`;
  fromAmount: bigint;
  slippageBps?: number;
  getViemClients: (accountName: string, network: CdpNetwork) => Promise<{
    walletClient: WalletClient;
    publicClient: PublicClient;
  }>;
}): Promise<{ transactionHash: string }> {
  const { account, accountName, network, fromToken, toToken, fromAmount, slippageBps = 100, getViemClients } = params;

  logger.info(`[Swap Utils] Executing swap: ${fromAmount.toString()} ${fromToken} to ${toToken} on ${network}`);

  // Check if CDP SDK supports swaps on this network
  if (isCdpSwapSupported(network)) {
    logger.info(`[Swap Utils] Using CDP SDK for swap on ${network}`);
    
    try {
      return await executeCdpSwap(
        account,
        accountName,
        network,
        fromToken,
        toToken,
        fromAmount,
        slippageBps,
        getViemClients
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Re-throw insufficient balance errors immediately
      if (errorMessage.includes("Insufficient ETH balance")) {
        throw error;
      }
      
      // CDP SDK failed for other reasons, fall through to 0x/Uniswap
      logger.warn(`[Swap Utils] CDP SDK swap failed: ${errorMessage}, trying fallbacks...`);
    }
  } else {
    logger.info(`[Swap Utils] CDP SDK does not support swaps on ${network}, using fallback providers`);
  }

  // Fallback to 0x API or Uniswap V3
  const { walletClient, publicClient } = await getViemClients(accountName, network);

  // Try 0x API first
  try {
    logger.info(`[Swap Utils] Attempting swap with 0x API...`);
    const result = await execute0xSwap(
      walletClient,
      publicClient,
      account,
      network,
      fromToken,
      toToken,
      fromAmount,
      slippageBps
    );

    logger.info(`[Swap Utils] 0x API swap successful: ${result.transactionHash}`);
    return {
      transactionHash: result.transactionHash,
    };
  } catch (zeroXError) {
    logger.warn(
      `[Swap Utils] 0x API swap failed:`,
      zeroXError instanceof Error ? zeroXError.message : String(zeroXError)
    );
    
    // Check for insufficient gas/balance
    const zeroXErrorMsg = zeroXError instanceof Error ? zeroXError.message : String(zeroXError);
    if (zeroXErrorMsg.includes("gas required exceeds allowance") || zeroXErrorMsg.includes("insufficient funds")) {
      throw new Error(`Insufficient ETH balance to pay for transaction gas fees. Please fund your wallet with ETH first.`);
    }
  }

  // Final fallback to Uniswap V3
  try {
    logger.info(`[Swap Utils] Using Uniswap V3 fallback for swap`);
    const result = await executeUniswapSwap(
      walletClient,
      publicClient,
      account,
      network,
      fromToken,
      toToken,
      fromAmount,
      slippageBps
    );

    logger.info(`[Swap Utils] Uniswap V3 swap successful: ${result.transactionHash}`);
    return {
      transactionHash: result.transactionHash,
    };
  } catch (uniswapError) {
    // Check for insufficient gas/balance
    const uniswapErrorMsg = uniswapError instanceof Error ? uniswapError.message : String(uniswapError);
    if (uniswapErrorMsg.includes("gas required exceeds allowance") || uniswapErrorMsg.includes("insufficient funds")) {
      throw new Error(`Insufficient ETH balance to pay for transaction gas fees. Please fund your wallet with ETH first.`);
    }
    
    logger.error(
      `[Swap Utils] All swap providers failed. Last error (Uniswap V3):`,
      uniswapError instanceof Error ? uniswapError.message : String(uniswapError)
    );
    throw new Error(`All swap providers failed. ${uniswapError instanceof Error ? uniswapError.message : String(uniswapError)}`);
  }
}

