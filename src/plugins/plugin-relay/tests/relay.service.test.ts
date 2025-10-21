import { describe, it, expect, beforeEach, mock } from "bun:test";
import { RelayService } from "../src/services/relay.service";
import type { IAgentRuntime } from "@elizaos/core";

describe("RelayService", () => {
  let relayService: RelayService;
  let mockRuntime: IAgentRuntime;

  beforeEach(() => {
    mockRuntime = {
      getSetting: mock((key: string) => {
        const settings: Record<string, string> = {
          RELAY_API_URL: "https://api.relay.link",
          EVM_PRIVATE_KEY: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        };
        return settings[key];
      }),
    } as unknown as IAgentRuntime;

    relayService = new RelayService();
  });

  describe("initialization", () => {
    it("should initialize with correct API URL", async () => {
      await relayService.initialize(mockRuntime);
      expect(mockRuntime.getSetting).toHaveBeenCalledWith("RELAY_API_URL");
    });

    it("should use default API URL if not configured", async () => {
      mockRuntime.getSetting = mock(() => undefined);
      await relayService.initialize(mockRuntime);
      // Service should still initialize without error
    });
  });

  describe("getQuote", () => {
    it("should get a quote for cross-chain transaction", async () => {
      await relayService.initialize(mockRuntime);

      const quoteRequest = {
        user: "0x742d35Cc6634C0532925a3b8d382F4d2d5d9a65e",
        originChainId: 1,
        destinationChainId: 8453,
        originCurrency: "eth",
        amount: "100000000000000000",
      };

      // Mock the fetch call
      global.fetch = mock(async () => ({
        ok: true,
        json: async () => ({
          steps: [],
          fees: { gas: "1000000", relayer: "500000" },
          breakdown: {},
          details: {
            rate: "1.0",
            totalImpact: "0.1",
            currencyIn: "eth",
            currencyOut: "eth",
            amountIn: "100000000000000000",
            amountOut: "99000000000000000",
          },
        }),
      })) as any;

      const quote = await relayService.getQuote(quoteRequest);

      expect(quote).toBeDefined();
      expect(quote.fees).toBeDefined();
      expect(quote.details).toBeDefined();
    });
  });

  describe("executeBridge", () => {
    it("should execute a bridge transaction", async () => {
      await relayService.initialize(mockRuntime);

      const bridgeRequest = {
        user: "0x742d35Cc6634C0532925a3b8d382F4d2d5d9a65e",
        originChainId: 1,
        destinationChainId: 8453,
        currency: "eth",
        amount: "100000000000000000",
      };

      global.fetch = mock(async () => ({
        ok: true,
        json: async () => ({
          requestId: "0x1234567890abcdef",
        }),
      })) as any;

      const requestId = await relayService.executeBridge(bridgeRequest);

      expect(requestId).toBe("0x1234567890abcdef");
    });

    it("should handle bridge execution errors", async () => {
      await relayService.initialize(mockRuntime);

      const bridgeRequest = {
        user: "0x742d35Cc6634C0532925a3b8d382F4d2d5d9a65e",
        originChainId: 1,
        destinationChainId: 8453,
        currency: "eth",
        amount: "100000000000000000",
      };

      global.fetch = mock(async () => ({
        ok: false,
        json: async () => ({
          message: "Insufficient funds",
        }),
      })) as any;

      await expect(relayService.executeBridge(bridgeRequest)).rejects.toThrow();
    });
  });

  describe("getStatus", () => {
    it("should get transaction status by request ID", async () => {
      await relayService.initialize(mockRuntime);

      global.fetch = mock(async () => ({
        ok: true,
        json: async () => ({
          requests: [
            {
              id: "0x1234567890abcdef",
              status: "success",
              user: "0x742d35Cc6634C0532925a3b8d382F4d2d5d9a65e",
              recipient: "0x742d35Cc6634C0532925a3b8d382F4d2d5d9a65e",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:10Z",
              data: {
                fees: { gas: "1000000", relayer: "500000" },
                inTxs: [{ hash: "0xabc", chainId: 1, timestamp: 1704067200 }],
                outTxs: [{ hash: "0xdef", chainId: 8453, timestamp: 1704067210 }],
              },
            },
          ],
        }),
      })) as any;

      const statuses = await relayService.getStatus({
        requestId: "0x1234567890abcdef",
      });

      expect(statuses).toHaveLength(1);
      expect(statuses[0].id).toBe("0x1234567890abcdef");
      expect(statuses[0].status).toBe("success");
    });
  });

  describe("getChains", () => {
    it("should get supported chains", async () => {
      await relayService.initialize(mockRuntime);

      global.fetch = mock(async () => ({
        ok: true,
        json: async () => ({
          chains: [
            {
              id: 1,
              name: "ethereum",
              displayName: "Ethereum",
              httpRpcUrl: "https://eth.llamarpc.com",
              depositEnabled: true,
              withdrawEnabled: true,
            },
          ],
        }),
      })) as any;

      const chains = await relayService.getChains();

      expect(chains).toHaveLength(1);
      expect(chains[0].id).toBe(1);
      expect(chains[0].name).toBe("ethereum");
    });
  });

  describe("getCurrencies", () => {
    it("should get supported currencies for a chain", async () => {
      await relayService.initialize(mockRuntime);

      global.fetch = mock(async () => ({
        ok: true,
        json: async () => ({
          currencies: [
            {
              currency: {
                contract: "0x0000000000000000000000000000000000000000",
                decimals: 18,
                name: "Ethereum",
                symbol: "ETH",
              },
              chainId: 1,
              depositEnabled: true,
              withdrawEnabled: true,
              minAmount: "1000000000000000",
              maxAmount: "1000000000000000000000",
            },
          ],
        }),
      })) as any;

      const currencies = await relayService.getCurrencies(1);

      expect(currencies).toHaveLength(1);
      expect(currencies[0].currency.symbol).toBe("ETH");
    });
  });

  describe("indexTransaction", () => {
    it("should index a transaction", async () => {
      await relayService.initialize(mockRuntime);

      global.fetch = mock(async () => ({
        ok: true,
        json: async () => ({}),
      })) as any;

      await expect(
        relayService.indexTransaction("0xabc123", 8453)
      ).resolves.not.toThrow();
    });

    it("should not throw on indexing errors", async () => {
      await relayService.initialize(mockRuntime);

      global.fetch = mock(async () => ({
        ok: false,
        json: async () => ({ error: "Failed" }),
      })) as any;

      await expect(
        relayService.indexTransaction("0xabc123", 8453)
      ).resolves.not.toThrow();
    });
  });
});
