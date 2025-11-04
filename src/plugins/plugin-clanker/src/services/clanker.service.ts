import { Service, IAgentRuntime, logger } from "@elizaos/core";
import { Clanker } from "clanker-sdk/v4";
import {
  TokenDeployParams,
  DeployResult,
  ErrorCode,
} from "../types";
import { ClankerError } from "../utils/errors";
import { retryTransaction } from "../utils/transactions";
import { CdpTransactionManager } from "@/managers/cdp-transaction-manager";

// Utility function to sanitize errors by converting BigInt values to strings
function sanitizeError(error: any): any {
  if (error === null || error === undefined) {
    return error;
  }

  if (typeof error === "bigint") {
    return error.toString();
  }

  if (error instanceof Error) {
    // Create a plain object with error properties
    const sanitized: any = {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };

    // Copy other enumerable properties and sanitize them
    for (const key in error) {
      if (Object.prototype.hasOwnProperty.call(error, key)) {
        sanitized[key] = sanitizeError((error as any)[key]);
      }
    }

    return sanitized;
  }

  if (Array.isArray(error)) {
    return error.map(sanitizeError);
  }

  if (typeof error === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(error)) {
      result[key] = sanitizeError(value);
    }
    return result;
  }

  return error;
}

// Helper function to detect platform from URL
function detectPlatform(url: string): string {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) return 'x';
  if (lowerUrl.includes('telegram') || lowerUrl.includes('t.me')) return 'telegram';
  if (lowerUrl.includes('discord')) return 'discord';
  if (lowerUrl.includes('github')) return 'github';
  if (lowerUrl.includes('reddit')) return 'reddit';
  if (lowerUrl.includes('medium')) return 'medium';
  if (lowerUrl.includes('youtube')) return 'youtube';
  if (lowerUrl.includes('instagram')) return 'instagram';
  if (lowerUrl.includes('tiktok')) return 'tiktok';
  if (lowerUrl.includes('linkedin')) return 'linkedin';
  if (lowerUrl.includes('facebook')) return 'facebook';
  return 'other'; // fallback
}

export class ClankerService extends Service {
  static serviceType = "clanker";
  capabilityDescription = "";
  private transactionManager: CdpTransactionManager;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.transactionManager = CdpTransactionManager.getInstance();
  }

  async getOrCreateWallet(accountName: string): Promise<{ address: string; accountName: string }> {
    return this.transactionManager.getOrCreateWallet(accountName);
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    logger.info("Initializing Clanker service...");
  }

  static async start(runtime: IAgentRuntime): Promise<ClankerService> {
    const service = new ClankerService(runtime);
    await service.initialize(runtime);
    return service;
  }

  async deployToken(
    params: TokenDeployParams,
    accountName: string,
  ): Promise<DeployResult> {
    const viemClient = await this.transactionManager.getViemClientsForAccount({
      accountName,
      network: "base",
    });
    const walletClient = viemClient.walletClient;
    const publicClient = viemClient.publicClient;

    const clanker = new Clanker({ wallet: walletClient as any, publicClient: publicClient as any });

    // Test connections
    await publicClient.getChainId();

    try {
      // Validate parameters
      if (!params.name || params.name.length > 50) {
        throw new ClankerError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid token name - must be 1-50 characters",
        );
      }

      if (!params.symbol || params.symbol.length > 10) {
        throw new ClankerError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid token symbol - must be 1-10 characters",
        );
      }

      const tokenConfig: any = {
        name: params.name,
        symbol: params.symbol,
        tokenAdmin: (walletClient as any).account?.address || params.tokenAdmin,
        vanity: params.vanity || false,
      };

      if (params.image) tokenConfig.image = params.image;
      if (params.metadata) {
        tokenConfig.metadata = {
          description: params.metadata.description || "",
          // Transform string URLs to objects with platform and url
          socialMediaUrls: params.metadata.socialMediaUrls 
            ? params.metadata.socialMediaUrls.map((url: string) => ({
                platform: detectPlatform(url),
                url: url,
              }))
            : [],
          auditUrls: params.metadata.auditUrls || [],
        };
      }
      tokenConfig.context = {
        interface: params.context?.interface || "Clanker SDK",
        platform: params.context?.platform || "",
        messageId: params.context?.messageId || "",
        id: params.context?.id || "",
      };
      if (params.pool) tokenConfig.pool = params.pool;
      if (params.fees) tokenConfig.fees = params.fees;
      if (params.rewards) tokenConfig.rewards = params.rewards;
      if (params.vault) tokenConfig.vault = params.vault;
      if (params.devBuy) tokenConfig.devBuy = { ethAmount: params.devBuy.ethAmount };

      const deployResult = await retryTransaction(async () => {
        logger.info(
          "Deploying token with config:",
          JSON.stringify(tokenConfig, null, 2),
        );

        const { txHash, waitForTransaction, error } = await clanker!.deploy(tokenConfig);
        if (error) {
          // Sanitize error to remove BigInt before logging/throwing
          const sanitizedError = sanitizeError(error);
          logger.error(`Clanker deploy error:`, sanitizedError);
          throw new Error(typeof sanitizedError === 'string' ? sanitizedError : (sanitizedError?.message || String(sanitizedError)));
        }
        if (!txHash) throw new Error("No transaction hash returned from deployment");
        logger.info("Token deployment transaction submitted:", txHash);

        const { address, error: waitError } = await waitForTransaction();
        if (waitError) {
          // Sanitize error to remove BigInt before logging/throwing
          const sanitizedWaitError = sanitizeError(waitError);
          logger.error(`Clanker waitForTransaction error:`, sanitizedWaitError);
          throw new Error(typeof sanitizedWaitError === 'string' ? sanitizedWaitError : (sanitizedWaitError?.message || String(sanitizedWaitError)));
        }
        if (!address) throw new Error("No contract address returned from deployment");
        logger.info("Token deployed successfully to address:", address);
        
        // Fetch transaction receipt to get actual deployment cost
        let deploymentCost = BigInt(0);
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
          if (receipt) {
            deploymentCost = receipt.gasUsed * receipt.effectiveGasPrice;
            logger.info(`Deployment cost: ${deploymentCost.toString()} wei (${Number(deploymentCost) / 1e18} ETH)`);
          }
        } catch (receiptError) {
          logger.warn("Failed to fetch deployment cost from transaction receipt:", 
            receiptError instanceof Error ? receiptError.message : String(receiptError)
          );
          // Keep deploymentCost as 0 if we can't fetch it
        }
        
        return {
          contractAddress: address,
          transactionHash: txHash,
          deploymentCost: deploymentCost.toString(), // Convert BigInt to string for JSON serialization
          tokenId: `clanker_${params.symbol.toLowerCase()}_${Date.now()}`,
        } as DeployResult;
      }, 3);

      return deployResult;
    } catch (error) {
      // Sanitize error to remove BigInt before logging/throwing
      const sanitizedError = sanitizeError(error);
      const errorMessage = sanitizedError instanceof Error 
        ? sanitizedError.message 
        : (typeof sanitizedError === 'string' ? sanitizedError : String(sanitizedError));
      
      logger.error("Token deployment failed:", errorMessage);
      
      if (error instanceof ClankerError) throw error;
      throw new ClankerError(
        ErrorCode.PROTOCOL_ERROR,
        "Token deployment failed",
        sanitizedError, // Pass sanitized error
      );
    }
  }

  async stop(): Promise<void> {
    logger.info("Stopping Clanker service...");
  }
}
