const mockCreatePersistStore = jest.fn();

jest.mock('@/utils/env', () => ({ isManifestV3: false }));
jest.mock('webextension-polyfill', () => ({}));
jest.mock('@/background/utils', () => ({
  createPersistStore: (...args: unknown[]) => mockCreatePersistStore(...args),
}));
jest.mock('@/background/service/permission', () => ({
  __esModule: true,
  default: { getMetamaskModeSites: () => [] },
}));

import { metamaskModeService } from '@/background/service/metamaskModeService';

// Hippo adaptation of upstream 42a5beafc (#4345): the remote
// fake_mm_dapps fetch was removed from the Hippo service, so only the
// corrupt-store guard applies. There is deliberately NO mock of
// @/background/utils/http here: if a remote fetch is ever reintroduced,
// this suite must be updated consciously, not silently.

describe('metamaskModeService site list (Hippo, remote fetch removed)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreatePersistStore.mockReset();
    metamaskModeService.store = { sites: [], updatedAt: 0 };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([null, {}, 42, ['ok.example', 1]])(
    'resets a persisted list of %p instead of throwing on later requests',
    async (sites) => {
      mockCreatePersistStore.mockResolvedValue({
        sites,
        updatedAt: Date.now(),
      });

      await metamaskModeService.init();
      expect(metamaskModeService.store.sites).toEqual([]);
      expect(() =>
        metamaskModeService.checkIsMetamaskMode('https://x.example')
      ).not.toThrow();
      expect(
        metamaskModeService.checkIsMetamaskMode('https://x.example')
      ).toBe(false);
    }
  );

  it('keeps a valid persisted list and answers from it without any network', async () => {
    mockCreatePersistStore.mockResolvedValue({
      sites: ['dapp.example'],
      updatedAt: 0,
    });

    await metamaskModeService.init();

    expect(
      metamaskModeService.checkIsMetamaskMode('https://dapp.example')
    ).toBe(true);
    await expect(metamaskModeService.syncMetamaskModeList()).resolves.toEqual([
      'dapp.example',
    ]);
  });
});
