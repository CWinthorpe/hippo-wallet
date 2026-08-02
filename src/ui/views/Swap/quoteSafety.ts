export const freshQuotePreservesReviewedMinimum = (
  reviewedMinimumAmountOut: string,
  freshMinimumAmountOut: string
) => BigInt(freshMinimumAmountOut) >= BigInt(reviewedMinimumAmountOut);
