import type { Plugin } from "@elizaos/core";
import { EtherscanService } from "./services/etherscan.service";
import { checkTransactionConfirmationAction } from "./actions/checkTransactionConfirmation.action";
import { shouldEtherscanPluginBeInContext } from "../matcher";

export const etherscanPlugin: Plugin = {
  name: "etherscan",
  description:
    "Etherscan integration for checking transaction confirmations, contract verification status, and blockchain data on Ethereum and other EVM chains",
  actions: [checkTransactionConfirmationAction],
  services: [EtherscanService],
  evaluators: [],
  providers: [],
};

export default etherscanPlugin;
export { EtherscanService, checkTransactionConfirmationAction, shouldEtherscanPluginBeInContext };
export * from "./utils/actionHelpers";

