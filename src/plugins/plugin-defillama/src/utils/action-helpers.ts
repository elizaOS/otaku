import type { HandlerCallback } from "@elizaos/core";
import type { ActionResult } from "@elizaos/core";

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

