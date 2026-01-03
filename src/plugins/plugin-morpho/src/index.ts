import { morphoPlugin } from "./plugin";

// Export the default plugin
export default morphoPlugin;

// Named exports for convenience
export { morphoPlugin };

// Export services
export { MorphoService } from "./services";

// Export actions
export { marketInfoAction } from "./actions";

// Export matcher
export { shouldMorphoPluginBeInContext, morphoKeywordPatterns } from "../matcher";

// Export types
export * from "./types";

// Export utilities
export {
  ErrorHandler,
  MorphoError,
  // GasOptimizer
} from "./utils";
