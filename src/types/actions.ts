import type { Action } from '@elizaos/core';

/**
 * Parameter definition for tool calling actions
 */
export interface ActionParameter {
  type: string;
  description: string;
  required: boolean;
}

/**
 * Extended Action interface that supports parameter schemas for tool calling.
 * Use this type when defining actions that need to declare their parameters
 * for the LLM to extract from conversation context.
 * 
 * @example
 * ```typescript
 * export const myAction: ActionWithParams = {
 *   name: "MY_ACTION",
 *   description: "Does something useful",
 *   parameters: {
 *     requiredParam: {
 *       type: "string",
 *       description: "A required parameter",
 *       required: true,
 *     },
 *   },
 *   validate: async (runtime) => true,
 *   handler: async (runtime, message, state) => {
 *     const params = state?.data?.actionParams || {};
 *     const value = params.requiredParam;
 *     // ... use parameter
 *   },
 * };
 * ```
 */
export interface ActionWithParams extends Action {
  parameters?: Record<string, ActionParameter>;
}

