import type { ValidatedCowSwapQuote } from '@/background/service/cowSwap';

const ORDER_SIGNING_BUFFER_MS = 60 * 1000;
const NATIVE_ORDER_EXECUTION_BUFFER_MS = 2 * 60 * 1000;

export const isReviewedCowSwapQuoteExecutable = (
  quote: ValidatedCowSwapQuote,
  now = Date.now()
) =>
  quote.provider === 'CoW Swap' &&
  quote.expiresAt >
    now +
      (quote.nativeSell
        ? NATIVE_ORDER_EXECUTION_BUFFER_MS
        : ORDER_SIGNING_BUFFER_MS);
