import stats from '@/stats';

describe('private-build stats reporter', () => {
  test('is a permanent no-op', async () => {
    await expect(
      stats.report('submitTransaction', {
        chainId: 'eth',
        success: true,
      })
    ).resolves.toBeUndefined();
  });
});
