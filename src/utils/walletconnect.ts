import { getChainList } from './chain';
import { ConstructorOptions } from '@rabby-wallet/eth-walletconnect-keyring/type';
import {
  HIPPO_WALLET_ICON_DATA_URI,
  HIPPO_WALLET_NAME,
  HIPPO_WALLET_REPOSITORY,
} from '@/constant/hippo-brand';

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
      description: 'Privacy-focused self-custodial browser wallet',
      url: HIPPO_WALLET_REPOSITORY,
      icons: [HIPPO_WALLET_ICON_DATA_URI],
      name: HIPPO_WALLET_NAME,
    },
    projectId,
  };
};

export const allChainIds = getChainList('mainnet').map((item) => item.id);
