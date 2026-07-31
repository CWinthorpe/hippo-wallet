jest.mock('i18next', () => ({
  t: (key: string) => key,
}));

jest.mock('@/utils/chain', () => ({
  getChainList: () => [{ id: 1 }],
}));

import { GET_WALLETCONNECT_CONFIG } from '@/utils/walletconnect';

describe('private WalletConnect identity', () => {
  const previousProjectId = process.env.WALLETCONNECT_PROJECT_ID;

  afterEach(() => {
    process.env.WALLETCONNECT_PROJECT_ID = previousProjectId;
  });

  test('refuses to use Rabby upstream credentials', () => {
    delete process.env.WALLETCONNECT_PROJECT_ID;
    expect(() => GET_WALLETCONNECT_CONFIG()).toThrow(
      'WALLETCONNECT_PROJECT_ID'
    );
  });

  test('uses the operator project id and private-build metadata', () => {
    process.env.WALLETCONNECT_PROJECT_ID = 'operator-project-id';
    const config = GET_WALLETCONNECT_CONFIG();

    expect(config.projectId).toBe('operator-project-id');
    expect(config.clientMeta.name).toBe('Private Wallet');
    expect(config.clientMeta.url).not.toContain('rabby.io');
    expect(config.clientMeta.icons).toEqual([]);
  });
});
