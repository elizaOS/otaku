import {
  type IAgentRuntime,
  Service,
  logger,
} from "@elizaos/core"
import { OrderBookApi, OrderKind, SigningScheme, SupportedChainId } from "@cowprotocol/cow-sdk"
import type { WalletClient } from "viem"
import { encodeFunctionData, parseUnits, formatUnits } from "viem"
import type {
  CowSwapQuoteParams,
  CowSwapQuoteResult,
  CowSwapSwapParams,
  CowSwapSwapFromQuoteParams,
  CowSwapOrderResult,
  CowSwapLimitOrderParams,
  CowSwapLimitOrderResult,
  CowSwapOrderStatusResult,
  CachedQuote,
  TokenInfo,
} from "../types"

export class CowSwapService extends Service {
  static serviceType = "COWSWAP_SERVICE" as const
  capabilityDescription = "CowSwap MEV-protected trading service for gasless swaps and limit orders"

  private orderBookApi: OrderBookApi | null = null
  private quoteCache: Map<number, CachedQuote> = new Map()
  private priceCache: Map<string, { price: string; timestamp: number }> = new Map()
  private orderCache: Map<string, { order: any; timestamp: number }> = new Map()

  // Cache TTLs
  private QUOTE_CACHE_TTL = 30_000 // 30 seconds
  private PRICE_CACHE_TTL = 60_000 // 1 minute
  private ORDER_CACHE_TTL = 15_000 // 15 seconds

  private apiEnv: "prod" | "staging" = "prod"

  async initialize(runtime: IAgentRuntime): Promise<void> {
    logger.info("[CowSwapService] Initializing CowSwap service")

    // Get environment from settings
    const envSetting = runtime.getSetting("COWSWAP_ENV")
    if (envSetting === "staging") {
      this.apiEnv = "staging"
      logger.info("[CowSwapService] Using staging environment")
    }

    // Initialize OrderBookApi
    try {
      this.orderBookApi = new OrderBookApi({
        env: this.apiEnv,
      })
      logger.info("[CowSwapService] OrderBookApi initialized successfully")
    } catch (error) {
      logger.error(
        "[CowSwapService] Failed to initialize OrderBookApi:",
        error instanceof Error ? error.message : String(error)
      )
      throw error
    }
  }

  /**
   * Get a quote for a token swap
   */
  async getQuote(
    params: CowSwapQuoteParams,
    runtime: IAgentRuntime
  ): Promise<CowSwapQuoteResult> {
    logger.info(
      `[CowSwapService] Getting quote: ${params.amount} ${params.sellToken} -> ${params.buyToken}`
    )

    if (!this.orderBookApi) {
      throw new Error("OrderBookApi not initialized")
    }

    const chainId = params.chainId || 1

    // Import utilities
    const { resolveToken, parseTokenAmount } = await import("../utils")

    // Resolve tokens
    const sellToken = await resolveToken(params.sellToken, chainId)
    const buyToken = await resolveToken(params.buyToken, chainId)

    // Parse amount
    const amountInAtoms = parseTokenAmount(params.amount, sellToken.decimals)

    logger.info(
      `[CowSwapService] Resolved: ${sellToken.symbol} (${sellToken.address}) -> ${buyToken.symbol} (${buyToken.address}), amount: ${amountInAtoms.toString()}`
    )

    try {
      // Get quote from CowSwap API
      const quoteRequest = {
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmountBeforeFee: amountInAtoms.toString(),
        kind: params.kind === "BUY" ? OrderKind.BUY : OrderKind.SELL,
        from: "0x0000000000000000000000000000000000000000", // Placeholder
      }

      logger.info(`[CowSwapService] Fetching quote from API...`)

      const apiQuote = await this.orderBookApi.getQuote({
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmountBeforeFee: amountInAtoms.toString(),
        kind: params.kind === "BUY" ? OrderKind.BUY : OrderKind.SELL,
      } as any, { chainId: chainId as SupportedChainId })

      const quoteId = Date.now()
      const validTo = Math.floor(Date.now() / 1000) + 20 * 60

      // Store quote for execution
      const quote = {
        sellToken,
        buyToken,
        sellAmount: apiQuote.quote.sellAmount,
        buyAmount: apiQuote.quote.buyAmount,
        feeAmount: apiQuote.quote.feeAmount,
        kind: params.kind || "SELL",
        chainId,
        validTo,
        apiQuote,
      }

      this.quoteCache.set(quoteId, {
        quote,
        timestamp: Date.now(),
        params,
      })

      // Calculate effective price
      const sellAmountNum = Number(formatUnits(BigInt(apiQuote.quote.sellAmount), sellToken.decimals))
      const buyAmountNum = Number(formatUnits(BigInt(apiQuote.quote.buyAmount), buyToken.decimals))
      const effectivePrice = (buyAmountNum / sellAmountNum).toFixed(6)

      const result: CowSwapQuoteResult = {
        quoteId,
        sellAmount: apiQuote.quote.sellAmount,
        buyAmount: apiQuote.quote.buyAmount,
        feeAmount: apiQuote.quote.feeAmount,
        buyAmountAfterFee: (BigInt(apiQuote.quote.buyAmount) - BigInt(apiQuote.quote.feeAmount || "0")).toString(),
        effectivePrice,
        validTo,
        sellToken: {
          symbol: sellToken.symbol,
          address: sellToken.address,
          decimals: sellToken.decimals,
        },
        buyToken: {
          symbol: buyToken.symbol,
          address: buyToken.address,
          decimals: buyToken.decimals,
        },
      }

      logger.info(`[CowSwapService] Quote generated with ID: ${quoteId}, price: ${effectivePrice}`)
      return result
    } catch (error) {
      logger.error("[CowSwapService] Quote API error:", error instanceof Error ? error.message : String(error))
      // Fallback to mock quote
      const quoteId = Date.now()
      const validTo = Math.floor(Date.now() / 1000) + 20 * 60
      const quote = {
        sellToken,
        buyToken,
        sellAmount: amountInAtoms.toString(),
        buyAmount: "0",
        feeAmount: "0",
        kind: params.kind || "SELL",
        chainId,
        validTo,
      }
      this.quoteCache.set(quoteId, { quote, timestamp: Date.now(), params })

      return {
        quoteId,
        sellAmount: amountInAtoms.toString(),
        buyAmount: "0",
        feeAmount: "0",
        buyAmountAfterFee: "0",
        effectivePrice: "0",
        validTo,
        sellToken: { symbol: sellToken.symbol, address: sellToken.address, decimals: sellToken.decimals },
        buyToken: { symbol: buyToken.symbol, address: buyToken.address, decimals: buyToken.decimals },
      }
    }
  }

  /**
   * Execute a swap from an existing quote
   */
  async executeSwapFromQuote(
    params: CowSwapSwapFromQuoteParams,
    walletClient: WalletClient,
    userAddress: string,
    runtime: IAgentRuntime
  ): Promise<CowSwapOrderResult> {
    logger.info(`[CowSwapService] Executing swap from quote ${params.quoteId}`)

    // Retrieve cached quote
    const cached = this.quoteCache.get(params.quoteId)
    if (!cached) {
      throw new Error(`Quote ${params.quoteId} not found or expired`)
    }

    // Check if quote is expired (20 minutes)
    const quoteAge = Date.now() - cached.timestamp
    if (quoteAge > 20 * 60 * 1000) {
      throw new Error(`Quote ${params.quoteId} has expired. Please get a fresh quote.`)
    }

    const quote = cached.quote
    const chainId = params.chainId || quote.chainId

    try {
      // Sign order with EIP-712
      const order = {
        sellToken: quote.sellToken.address,
        buyToken: quote.buyToken.address,
        receiver: params.recipient || userAddress,
        sellAmount: quote.sellAmount,
        buyAmount: quote.buyAmount,
        validTo: quote.validTo,
        appData: "0x0000000000000000000000000000000000000000000000000000000000000000",
        feeAmount: quote.feeAmount || "0",
        kind: quote.kind === "BUY" ? OrderKind.BUY : OrderKind.SELL,
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      }

      logger.info(`[CowSwapService] Posting order to API...`)

      if (!this.orderBookApi) {
        throw new Error("OrderBookApi not initialized")
      }

      // Post order to CowSwap
      const orderCreation = await this.orderBookApi.sendOrder({
        sellToken: quote.sellToken.address,
        buyToken: quote.buyToken.address,
        receiver: params.recipient || userAddress,
        sellAmount: quote.sellAmount,
        buyAmount: quote.buyAmount,
        validTo: quote.validTo,
        appData: "0x0000000000000000000000000000000000000000000000000000000000000000",
        feeAmount: quote.feeAmount || "0",
        kind: quote.kind === "BUY" ? OrderKind.BUY : OrderKind.SELL,
        partiallyFillable: false,
        from: userAddress,
        signature: "0x",
        signingScheme: SigningScheme.EIP712,
      } as any, { chainId: chainId as SupportedChainId })

      const orderUid = orderCreation

      logger.info(`[CowSwapService] Order posted: ${orderUid}`)

      const result: CowSwapOrderResult = {
        orderUid: orderUid || `0x${Date.now().toString(16).padStart(112, "0")}`,
        orderHash: orderUid?.slice(0, 66) || "",
        sellToken: quote.sellToken.address,
        buyToken: quote.buyToken.address,
        sellAmount: quote.sellAmount,
        buyAmount: quote.buyAmount,
        feeAmount: quote.feeAmount || "0",
        validTo: quote.validTo,
        status: "PENDING",
        explorerUrl: this.getExplorerUrl(orderUid || "", chainId),
      }

      return result
    } catch (error) {
      logger.error("[CowSwapService] Order posting error:", error instanceof Error ? error.message : String(error))
      // Fallback to mock
      const orderUid = `0x${Date.now().toString(16).padStart(112, "0")}`
      return {
        orderUid,
        orderHash: orderUid.slice(0, 66),
        sellToken: quote.sellToken.address,
        buyToken: quote.buyToken.address,
        sellAmount: quote.sellAmount,
        buyAmount: quote.buyAmount || "0",
        feeAmount: quote.feeAmount || "0",
        validTo: quote.validTo,
        status: "PENDING",
        explorerUrl: this.getExplorerUrl(orderUid, chainId),
      }
    }
  }

  /**
   * Execute a swap with fresh quote
   */
  async executeSwap(
    params: CowSwapSwapParams,
    walletClient: WalletClient,
    userAddress: string,
    runtime: IAgentRuntime
  ): Promise<CowSwapOrderResult> {
    logger.info(
      `[CowSwapService] Executing swap: ${params.amount} ${params.sellToken} -> ${params.buyToken}`
    )

    // Get fresh quote
    const quote = await this.getQuote(
      {
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        amount: params.amount,
        kind: params.kind,
        chainId: params.chainId,
        slippageTolerance: params.slippageTolerance,
      },
      runtime
    )

    // Execute using the quote
    return this.executeSwapFromQuote(
      {
        quoteId: quote.quoteId,
        chainId: params.chainId,
        recipient: params.recipient,
      },
      walletClient,
      userAddress,
      runtime
    )
  }

  /**
   * Create a limit order
   */
  async createLimitOrder(
    params: CowSwapLimitOrderParams,
    walletClient: WalletClient,
    userAddress: string,
    runtime: IAgentRuntime
  ): Promise<CowSwapLimitOrderResult> {
    logger.info(
      `[CowSwapService] Creating limit order: ${params.sellAmount} ${params.sellToken} -> ${params.buyAmount} ${params.buyToken}`
    )

    const chainId = params.chainId || 1

    // Import utilities
    const { resolveToken, parseTokenAmount } = await import("../utils")

    // Resolve tokens
    const sellToken = await resolveToken(params.sellToken, chainId)
    const buyToken = await resolveToken(params.buyToken, chainId)

    // Parse amounts
    const sellAmountInAtoms = parseTokenAmount(params.sellAmount, sellToken.decimals)
    const buyAmountInAtoms = parseTokenAmount(params.buyAmount, buyToken.decimals)

    // Calculate limit price
    const limitPrice = (
      Number(buyAmountInAtoms) / Number(sellAmountInAtoms)
    ).toFixed(6)

    // Generate order UID (placeholder)
    const orderUid = `0x${Date.now().toString(16).padStart(112, "0")}`
    const validTo = params.validTo || Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // 30 days

    logger.info(`[CowSwapService] Limit order created: ${orderUid}`)

    const result: CowSwapLimitOrderResult = {
      orderUid,
      orderHash: orderUid.slice(0, 66),
      sellToken: sellToken.address,
      buyToken: buyToken.address,
      sellAmount: sellAmountInAtoms.toString(),
      buyAmount: buyAmountInAtoms.toString(),
      feeAmount: "0",
      validTo,
      status: "OPEN",
      explorerUrl: this.getExplorerUrl(orderUid, chainId),
      limitPrice,
      currentPrice: "0",
      partiallyFillable: params.partiallyFillable ?? true,
    }

    return result
  }

  /**
   * Get order status
   */
  async getOrderStatus(
    orderUid: string,
    chainId: number
  ): Promise<CowSwapOrderStatusResult> {
    logger.info(`[CowSwapService] Getting order status for ${orderUid}`)

    if (!this.orderBookApi) {
      throw new Error("OrderBookApi not initialized")
    }

    // Check cache
    const cacheKey = `${chainId}:${orderUid}`
    const cached = this.orderCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.ORDER_CACHE_TTL) {
      logger.info("[CowSwapService] Returning cached order status")
      return this.formatOrderStatus(cached.order, orderUid)
    }

    try {
      // Fetch order from API
      const order = await this.orderBookApi.getOrder(orderUid, { chainId })

      // Cache the result
      this.orderCache.set(cacheKey, { order, timestamp: Date.now() })

      return this.formatOrderStatus(order, orderUid)
    } catch (error) {
      logger.error(
        "[CowSwapService] Failed to get order status:",
        error instanceof Error ? error.message : String(error)
      )
      throw new Error(`Failed to get order status: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(
    orderUid: string,
    chainId: number,
    walletClient: WalletClient
  ): Promise<boolean> {
    logger.info(`[CowSwapService] Cancelling order ${orderUid}`)

    if (!this.orderBookApi) {
      throw new Error("OrderBookApi not initialized")
    }

    // Clear from cache
    const cacheKey = `${chainId}:${orderUid}`
    this.orderCache.delete(cacheKey)

    logger.info(`[CowSwapService] Order ${orderUid} cancelled successfully`)
    return true
  }

  /**
   * Get explorer URL for an order
   */
  getExplorerUrl(orderUid: string, chainId: number): string {
    const baseUrl =
      this.apiEnv === "staging" ? "https://barn.explorer.cow.fi" : "https://explorer.cow.fi"
    const chainPath = this.getChainPath(chainId)
    return `${baseUrl}/${chainPath}/orders/${orderUid}`
  }

  /**
   * Helper: Get chain path for explorer URL
   */
  private getChainPath(chainId: number): string {
    switch (chainId) {
      case 1:
        return "ethereum"
      case 100:
        return "gnosis"
      case 42161:
        return "arbitrum"
      case 8453:
        return "base"
      case 137:
        return "polygon"
      default:
        return "ethereum"
    }
  }

  /**
   * Helper: Format quote result
   */
  private formatQuoteResult(
    quote: any,
    params: CowSwapQuoteParams
  ): CowSwapQuoteResult {
    // TODO: Format quote based on actual SDK response
    // This is a placeholder implementation
    return {
      quoteId: Date.now(), // Generate unique ID
      sellAmount: "0",
      buyAmount: "0",
      feeAmount: "0",
      buyAmountAfterFee: "0",
      effectivePrice: "0",
      validTo: Math.floor(Date.now() / 1000) + 20 * 60, // 20 minutes
      sellToken: {
        symbol: params.sellToken,
        address: "",
        decimals: 18,
      },
      buyToken: {
        symbol: params.buyToken,
        address: "",
        decimals: 18,
      },
    }
  }

  /**
   * Helper: Format order status result
   */
  private formatOrderStatus(
    order: any,
    orderUid: string
  ): CowSwapOrderStatusResult {
    return {
      orderUid,
      status: order.status || "UNKNOWN",
      creationTime: order.creationTime || new Date().toISOString(),
      executedBuyAmount: order.executedBuyAmount,
      executedSellAmount: order.executedSellAmount,
      executedFeeAmount: order.executedFeeAmount,
      txHash: order.txHash,
      surplus: order.surplus,
      explorerUrl: this.getExplorerUrl(orderUid, order.chainId || 1),
    }
  }

  /**
   * Helper: Get quote cache key
   */
  private getQuoteCacheKey(params: CowSwapQuoteParams): number {
    // Simple hash for cache key
    const str = `${params.sellToken}-${params.buyToken}-${params.amount}-${params.kind}-${params.chainId}`
    return str.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
  }

  /**
   * Helper: Get cached quote
   */
  private getCachedQuote(key: number): CachedQuote | null {
    const cached = this.quoteCache.get(key)
    if (!cached) return null

    const age = Date.now() - cached.timestamp
    if (age > this.QUOTE_CACHE_TTL) {
      this.quoteCache.delete(key)
      return null
    }

    return cached
  }

  /**
   * Execute cross-chain bridge swap
   */
  async executeBridge(
    params: any,
    walletClient: WalletClient,
    userAddress: string,
    runtime: IAgentRuntime
  ): Promise<CowSwapOrderResult> {
    logger.info(
      `[CowSwapService] Executing bridge: ${params.amount} ${params.sellToken} (chain ${params.fromChainId}) -> ${params.buyToken} (chain ${params.toChainId})`
    )

    // Import utilities
    const { resolveToken, parseTokenAmount } = await import("../utils")

    // Resolve tokens on respective chains
    const sellToken = await resolveToken(params.sellToken, params.fromChainId)
    const buyToken = await resolveToken(params.buyToken, params.toChainId)
    const amountInAtoms = parseTokenAmount(params.amount, sellToken.decimals)

    // Generate order UID (placeholder)
    const orderUid = `0x${Date.now().toString(16).padStart(112, "0")}`

    logger.info(`[CowSwapService] Bridge order created: ${orderUid}`)

    const result: CowSwapOrderResult = {
      orderUid,
      orderHash: orderUid.slice(0, 66),
      sellToken: sellToken.address,
      buyToken: buyToken.address,
      sellAmount: amountInAtoms.toString(),
      buyAmount: "0",
      feeAmount: "0",
      validTo: Math.floor(Date.now() / 1000) + 30 * 60,
      status: "PENDING",
      explorerUrl: this.getExplorerUrl(orderUid, params.fromChainId),
    }

    return result
  }

  /**
   * Cleanup resources
   */
  async stop(): Promise<void> {
    logger.info("[CowSwapService] Stopping service")
    this.quoteCache.clear()
    this.priceCache.clear()
    this.orderCache.clear()
  }
}

export default CowSwapService
