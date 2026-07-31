import { getChainList } from './chain';
import { ConstructorOptions } from '@rabby-wallet/eth-walletconnect-keyring/type';

export const GET_WALLETCONNECT_CONFIG: () => ConstructorOptions = () => {
  const projectId = process.env.WALLETCONNECT_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error(
      'WalletConnect requires WALLETCONNECT_PROJECT_ID from an operator-owned Reown project'
    );
  }

  return {
    // 1h
    maxDuration: 3600000,
    clientMeta: {
      description: 'Private browser wallet',
      url: 'https://localhost.invalid',
      icons: [],
      name: 'Private Wallet',
    },
    projectId,
  };
};

export const allChainIds = getChainList('mainnet').map((item) => item.id);
