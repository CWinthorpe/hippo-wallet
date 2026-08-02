import { isFreshCowSwapQuoteSafe } from '@/ui/views/Swap/cowSwapSafety';
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

describe('fresh CoW quote safety', () => {
  test('accepts a fresh quote that preserves or improves the reviewed minimum', () => {
    expect(
      isFreshCowSwapQuoteSafe(
        quote(),
        quote({ minimumAmountOut: '1790001', amountOut: '1801000' }),
        1_000_000
      )
    ).toBe(true);
  });

  test('rejects double slippage and execution-context changes', () => {
    const reviewed = quote();
    expect(
      isFreshCowSwapQuoteSafe(
        reviewed,
        quote({ minimumAmountOut: '1789999' }),
        1_000_000
      )
    ).toBe(false);
    expect(
      isFreshCowSwapQuoteSafe(
        reviewed,
        quote({
          approvalSpender: '0x0000000000000000000000000000000000000001',
        }),
        1_000_000
      )
    ).toBe(false);
    expect(
      isFreshCowSwapQuoteSafe(
        reviewed,
        quote({ amountIn: '999999999999999' }),
        1_000_000
      )
    ).toBe(false);
    expect(
      isFreshCowSwapQuoteSafe(
        reviewed,
        quote({ nativeSell: true, approvalSpender: null }),
        1_000_000
      )
    ).toBe(false);
  });

  test('rejects stale and internally inconsistent quotes', () => {
    const reviewed = quote();
    expect(
      isFreshCowSwapQuoteSafe(
        reviewed,
        quote({ expiresAt: 1_019_999 }),
        1_000_000
      )
    ).toBe(false);
    expect(
      isFreshCowSwapQuoteSafe(
        reviewed,
        quote({ amountOut: '1789999' }),
        1_000_000
      )
    ).toBe(false);
  });
});
