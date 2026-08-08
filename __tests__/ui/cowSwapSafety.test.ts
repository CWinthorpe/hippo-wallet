import { isReviewedCowSwapQuoteExecutable } from '@/ui/views/Swap/cowSwapSafety';
import type { ValidatedCowSwapQuote } from '@/background/service/cowSwap';

const quote = (
  overrides: Partial<ValidatedCowSwapQuote> = {}
): ValidatedCowSwapQuote => ({
  provider: 'CoW Swap',
  quoteHandle: `0x${'11'.repeat(32)}`,
  quoteId: 1,
  chainServerId: 'eth',
  chainId: 1,
  fromToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  toToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  amountIn: '1000000000000000',
  amountOut: '1800000',
  minimumAmountOut: '1790000',
  networkFeeAmount: '1000',
  protocolFeeBps: 2,
  slippageBps: 50,
  approvalSpender: '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110',
  nativeSell: false,
  expectedOrderUid: `0x${'22'.repeat(56)}`,
  expiresAt: 2_000_000,
  explorerUrl: `https://explorer.cow.fi/orders/0x${'22'.repeat(56)}`,
  signingPayload: null,
  ...overrides,
});

describe('reviewed CoW quote execution window', () => {
  test('allows an ERC-20 order with more than one minute remaining', () => {
    expect(
      isReviewedCowSwapQuoteExecutable(
        quote({ expiresAt: 1_060_001 }),
        1_000_000
      )
    ).toBe(true);
  });

  test('requires an updated review near ERC-20 expiry', () => {
    expect(
      isReviewedCowSwapQuoteExecutable(
        quote({ expiresAt: 1_060_000 }),
        1_000_000
      )
    ).toBe(false);
  });

  test('keeps a two-minute signing and mining buffer for EthFlow', () => {
    const native = quote({
      nativeSell: true,
      approvalSpender: null,
      expiresAt: 1_120_000,
    });
    expect(isReviewedCowSwapQuoteExecutable(native, 1_000_000)).toBe(false);
    expect(
      isReviewedCowSwapQuoteExecutable(
        { ...native, expiresAt: 1_120_001 },
        1_000_000
      )
    ).toBe(true);
  });
});
