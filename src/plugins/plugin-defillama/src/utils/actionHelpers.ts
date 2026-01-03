/**
 * Action Helper Utilities
 *
 * Shared utilities for DefiLlama plugin actions to reduce code duplication
 */

import type { HandlerCallback, IAgentRuntime, Memory, State } from "@elizaos/core";
import type { ActionResult } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { DefiLlamaService } from "../services/defillama.service";
import { shouldDefiLlamaPluginBeActive } from "../../matcher";

/**
 * Validate that DefiLlama service is available and plugin context is active
 *
 * @param runtime - Agent runtime
 * @param actionName - Name of action for logging
 * @param state - Optional state for plugin context check
 * @param message - Optional message for plugin context check
 * @returns True if service is available and plugin context is active
 */
export function validateDefillamaService(
  runtime: IAgentRuntime,
  actionName: string,
  state?: State,
  message?: Memory
): boolean {
  try {
    // Check plugin context first
    if (!shouldDefiLlamaPluginBeActive(state, message)) {
      return false;
    }

    const service = runtime.getService(
      DefiLlamaService.serviceType
    ) as DefiLlamaService | undefined;

    if (!service) {
      logger.warn(`[${actionName}] DefiLlama service not available`);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(
      `[${actionName}] Error validating action:`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

/**
 * Get DefiLlama service from runtime
 *
 * @param runtime - Agent runtime
 * @returns DefiLlama service instance or null
 */
export function getDefillamaService(
  runtime: IAgentRuntime
): DefiLlamaService | null {
  return runtime.getService(
    DefiLlamaService.serviceType
  ) as DefiLlamaService | null;
}

/**
 * Extract parameters from composed state
 *
 * @param runtime - Agent runtime
 * @param message - Memory message
 * @returns Action parameters object
 */
export async function extractActionParams<T>(
  runtime: IAgentRuntime,
  message: Memory
): Promise<Partial<T>> {
  const composedState = await runtime.composeState(
    message,
    ["ACTION_STATE"],
    true
  );
  return (composedState?.data?.actionParams ?? {}) as Partial<T>;
}

export function parsePositiveInteger(value: string | number | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

export function limitSeries<T>(series: T[], limit: number): T[] {
  if (!limit || series.length <= limit) {
    return series;
  }
  return series.slice(series.length - limit);
}

/**
 * Intelligently downsample time series data to reduce context size while preserving trends.
 * Uses adaptive sampling based on data length.
 */
export function downsampleSeries<T extends { date: number; totalLiquidityUsd: number }>(
  series: T[],
  maxPoints: number = 50,
): T[] {
  if (series.length <= maxPoints) {
    return series;
  }

  const step = Math.ceil(series.length / maxPoints);
  const downsampled: T[] = [];

  // Always include first point
  downsampled.push(series[0]);

  // Sample intermediate points at regular intervals
  for (let i = step; i < series.length - 1; i += step) {
    downsampled.push(series[i]);
  }

  // Always include last point (most recent)
  downsampled.push(series[series.length - 1]);

  return downsampled;
}

/**
 * Calculate summary statistics for TVL series to reduce context size
 */
export function calculateTvlSummary<T extends { date: number; totalLiquidityUsd: number }>(series: T[]): {
  current: number;
  min: number;
  max: number;
  ath: number;
  athDate: number;
  athDaysAgo: number;
  fromAth: number;
  fromAthPercent: number;
  average: number;
  change: number;
  changePercent: number;
  dataPoints: number;
  firstDate: number;
  lastDate: number;
} | null {
  if (series.length === 0) {
    return null;
  }

  const values = series.map((p) => p.totalLiquidityUsd);
  const current = values[values.length - 1];
  const first = values[0];
  const min = Math.min(...values);
  const max = Math.max(...values);

  // Find ATH (All-Time High) and its date
  let athValue = -Infinity;
  let athIndex = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i].totalLiquidityUsd > athValue) {
      athValue = series[i].totalLiquidityUsd;
      athIndex = i;
    }
  }
  const athDate = series[athIndex].date;
  const lastDate = series[series.length - 1].date;
  const athDaysAgo = Math.floor((lastDate - athDate) / 86400);
  const fromAth = current - athValue;
  const fromAthPercent = athValue !== 0 ? (fromAth / athValue) * 100 : 0;

  const average = values.reduce((sum, val) => sum + val, 0) / values.length;
  const change = current - first;
  const changePercent = first !== 0 ? (change / first) * 100 : 0;

  return {
    current: Math.round(current),
    min: Math.round(min),
    max: Math.round(max),
    ath: Math.round(athValue),
    athDate,
    athDaysAgo,
    fromAth: Math.round(fromAth),
    fromAthPercent: Math.round(fromAthPercent * 100) / 100,
    average: Math.round(average),
    change: Math.round(change),
    changePercent: Math.round(changePercent * 100) / 100,
    dataPoints: series.length,
    firstDate: series[0].date,
    lastDate: series[series.length - 1].date,
  };
}

export async function respondWithError(
  callback: HandlerCallback | undefined,
  messageText: string,
  errorCode: string,
  details?: Record<string, string | number | null>,
): Promise<ActionResult> {
  if (callback) {
    await callback({
      text: messageText,
      content: { error: errorCode, details },
    });
  }

  return {
    text: messageText,
    success: false,
    error: errorCode,
    data: details,
  };
}

const CHAIN_NAME_PATTERN = /^[A-Za-z0-9 .\-_/()]{2,}$/;

export function sanitizeChainName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return CHAIN_NAME_PATTERN.test(trimmed) ? trimmed : undefined;
}

const FILTER_PATTERN = /^[a-z\-]{2,}$/;

export function sanitizeFilterSegment(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  return FILTER_PATTERN.test(trimmed) ? trimmed : undefined;
}
