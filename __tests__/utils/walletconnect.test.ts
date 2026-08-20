jest.mock('i18next', () => ({
  t: (key: string) => key,
}));

jest.mock('@/utils/chain', () => ({
  getChainList: () => [{ id: 1 }],
}));

import { HIPPO_WALLETCONNECT_PROJECT_ID } from '@/constant/hippo-brand';
import { GET_WALLETCONNECT_CONFIG } from '@/utils/walletconnect';

describe('private WalletConnect identity', () => {
  const previousProjectId = process.env.WALLETCONNECT_PROJECT_ID;

  afterEach(() => {
    process.env.WALLETCONNECT_PROJECT_ID = previousProjectId;
  });

  test('uses the bundled Hippo-owned project id when the build has no override', () => {
    delete process.env.WALLETCONNECT_PROJECT_ID;
    const config = GET_WALLETCONNECT_CONFIG();

    expect(config.projectId).toBe(HIPPO_WALLETCONNECT_PROJECT_ID);
    expect(config.projectId).toMatch(/^[0-9a-f]{32}$/);
  });

  test('uses the operator project id and private-build metadata', () => {
    process.env.WALLETCONNECT_PROJECT_ID = 'operator-project-id';
    const config = GET_WALLETCONNECT_CONFIG();

    expect(config.projectId).toBe('operator-project-id');
    expect(config.clientMeta.name).toBe('Hippo Wallet');
    expect(config.clientMeta.url).toBe(
      'https://github.com/CWinthorpe/hippo-wallet'
    );
    expect(config.clientMeta.url).not.toContain('rabby.io');
    expect(config.clientMeta.icons).toHaveLength(1);
    expect(config.clientMeta.icons[0]).toMatch(
      /^data:image\/svg\+xml;base64,/
    );
  });
});
