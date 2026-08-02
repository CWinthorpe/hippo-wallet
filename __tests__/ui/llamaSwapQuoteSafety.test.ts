import { freshQuotePreservesReviewedMinimum } from '@/ui/views/Swap/quoteSafety';

describe('LlamaSwap refreshed quote safety', () => {
  test('rejects double-slippage drift below the minimum the user reviewed', () => {
    const reviewedOutput = 1_000_000n;
    const reviewedMinimum = (reviewedOutput * 9950n) / 10_000n;
    const freshOutput = reviewedMinimum;
    const freshMinimum = (freshOutput * 9950n) / 10_000n;

    expect(
      freshQuotePreservesReviewedMinimum(
        reviewedMinimum.toString(),
        freshMinimum.toString()
      )
    ).toBe(false);
  });

  test.each([
    ['995000', '995000'],
    ['995000', '995001'],
  ])(
    'accepts a refreshed transaction minimum at or above the reviewed minimum',
    (reviewedMinimum, freshMinimum) => {
      expect(
        freshQuotePreservesReviewedMinimum(reviewedMinimum, freshMinimum)
      ).toBe(true);
    }
  );

  test('fails closed on malformed amounts', () => {
    expect(() =>
      freshQuotePreservesReviewedMinimum('995000', 'not-an-amount')
    ).toThrow();
  });
});
