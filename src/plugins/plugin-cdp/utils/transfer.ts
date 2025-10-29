import { logger } from "@elizaos/core";
import type { PublicClient, WalletClient } from "viem";
import type { EvmServerAccount } from "@coinbase/cdp-sdk";
import { waitForTxConfirmation } from "../constants/timeouts";
import type { CdpNetwork } from "../types";

/**
 * Execute token transfer via CDP SDK with viem fallback
 * 
 * Tries CDP SDK first, falls back to viem if needed
 */
export async function executeTransfer(params: {
  account: EvmServerAccount;
  accountName: string;
  network: CdpNetwork;
  to: `0x${string}`;
  token: `0x${string}` | "eth";
  amount: bigint;
  getViemClients: (accountName: string, network: CdpNetwork) => Promise<{
    walletClient: WalletClient;
    publicClient: PublicClient;
  }>;
  getChainIdForNetwork: (network: CdpNetwork) => number;
  DEFAULT_RPC_URLS: Record<number, string>;
}): Promise<{ transactionHash: string; from: string }> {
  const { account, accountName, network, to, token, amount, getViemClients, getChainIdForNetwork, DEFAULT_RPC_URLS } = params;

  logger.info(
    `[Transfer Utils] Executing transfer on ${network}: to=${to}, token=${token}, amount=${amount.toString()}`,
  );

  let cdpSuccess = false;
  let transactionHash: string | undefined;
  const fromAddress = account.address;

  try {
    // Try CDP SDK first
    logger.info(`[Transfer Utils] Attempting transfer with CDP SDK...`);
    const networkAccount = await account.useNetwork(network);

    const result = await networkAccount.transfer({
      to,
      amount,
      token: token as any,
    });

    if (result.transactionHash) {
      transactionHash = result.transactionHash;
      cdpSuccess = true;
      logger.info(`[Transfer Utils] CDP SDK transfer transaction submitted: ${transactionHash}`);
      
      // Wait for confirmation
      const { publicClient } = await getViemClients(accountName, network);
      await waitForTxConfirmation(publicClient, transactionHash as `0x${string}`, "transfer");
    }
  } catch (cdpError) {
    logger.warn(
      `[Transfer Utils] CDP SDK transfer failed, trying viem fallback:`,
      cdpError instanceof Error ? cdpError.message : String(cdpError)
    );

    // Fallback to viem
    logger.info(`[Transfer Utils] Using viem fallback for transfer...`);
    
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      throw new Error('Alchemy API key not configured');
    }

    // Get viem clients
    const rpcUrl = process.env[`${network.toUpperCase()}_RPC_URL`] || DEFAULT_RPC_URLS[getChainIdForNetwork(network)];
    
    const { walletClient } = await getViemClients(accountName, network);

    // Check if it's a native token or ERC20
    const isNativeToken = !token.startsWith('0x');
    
    if (isNativeToken) {
      // Native token transfer (ETH, MATIC, etc.)
      logger.info(`[Transfer Utils] Sending native token via viem...`);
      const hash = await walletClient.sendTransaction({
        account: walletClient.account!,
        to,
        value: amount,
        chain: walletClient.chain,
      });
      transactionHash = hash;
    } else {
      // ERC20 token transfer
      logger.info(`[Transfer Utils] Sending ERC20 token ${token} via viem...`);
      
      const hash = await walletClient.writeContract({
        account: walletClient.account!,
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
        args: [to, amount],
        chain: walletClient.chain,
      });
      transactionHash = hash;
    }

    logger.info(`[Transfer Utils] Viem transfer transaction submitted: ${transactionHash}`);
    
    // Wait for confirmation
    const { publicClient } = await getViemClients(accountName, network);
    await waitForTxConfirmation(publicClient, transactionHash as `0x${string}`, "transfer");
  }

  if (!transactionHash) {
    throw new Error('Transfer did not return a transaction hash');
  }

  return {
    transactionHash,
    from: fromAddress,
  };
}

