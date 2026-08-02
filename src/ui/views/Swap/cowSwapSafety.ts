import type { ValidatedCowSwapQuote } from '@/background/service/cowSwap';

const sameNullableAddress = (left: string | null, right: string | null) =>
  left === null
    ? right === null
    : right !== null && left.toLowerCase() === right.toLowerCase();

export const isFreshCowSwapQuoteSafe = (
  reviewed: ValidatedCowSwapQuote,
  fresh: ValidatedCowSwapQuote,
  now = Date.now()
) => {
  try {
    return (
      reviewed.provider === 'CoW Swap' &&
      fresh.provider === 'CoW Swap' &&
      reviewed.chainServerId === fresh.chainServerId &&
      reviewed.chainId === fresh.chainId &&
      reviewed.fromToken.toLowerCase() === fresh.fromToken.toLowerCase() &&
      reviewed.toToken.toLowerCase() === fresh.toToken.toLowerCase() &&
      reviewed.amountIn === fresh.amountIn &&
      reviewed.slippageBps === fresh.slippageBps &&
      reviewed.nativeSell === fresh.nativeSell &&
      sameNullableAddress(reviewed.approvalSpender, fresh.approvalSpender) &&
      BigInt(fresh.minimumAmountOut) >= BigInt(reviewed.minimumAmountOut) &&
      BigInt(fresh.amountOut) >= BigInt(fresh.minimumAmountOut) &&
      fresh.expiresAt > now + 20_000
    );
  } catch {
    return false;
  }
};
