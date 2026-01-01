/**
 * Browser-only shim for `x402-fetch`.
 *
 * The real package only works in the backend runtime and is currently
 * missing proper ESM/CJS entrypoints, which breaks the Vite resolver during
 * frontend builds. The UI never calls these helpers, so we expose safe
 * no-op replacements that satisfy the bundler without affecting runtime.
 */

type FetchLike = typeof fetch;

export function wrapFetchWithPayment(fetchImpl: FetchLike, ..._rest: unknown[]) {
  // Frontend never does paid requests, return the original fetch intact.
  return fetchImpl;
}

export function decodeXPaymentResponse<T = Response>(response: T): T {
  return response;
}

