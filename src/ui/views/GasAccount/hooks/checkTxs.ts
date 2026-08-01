import { useCallback, useState } from 'react';
import { Account } from '@/background/service/preference';
import { Tx } from '@rabby-wallet/rabby-api/dist/types';

export const GAS_ACCOUNT_INSUFFICIENT_TIP =
  'Sponsored gas is not available in Hippo Wallet';

export const useGasAccountTxsCheck = ({
  currentAccount,
}: {
  isReady: boolean;
  txs: Tx[];
  noCustomRPC: boolean;
  isSupportedAddr: boolean;
  currentAccount: Account;
}) => {
  const [gasMethod, setGasMethod] = useState<'native' | 'gasAccount'>('native');
  return {
    gasAccountCost: undefined as any,
    gasMethod: gasMethod === 'gasAccount' ? 'native' : gasMethod,
    setGasMethod: (_method: 'native' | 'gasAccount') => setGasMethod('native'),
    isGasAccountLogin: false,
    setIsGasAccountLogin: () => undefined,
    gasAccountCanPay: false,
    canUseGasAccount: false,
    canGotoUseGasAccount: false,
    canDepositUseGasAccount: false,
    gasAccountCostFn: async () => undefined,
    gasAccountAddress: currentAccount.address,
    sig: '',
    isFirstGasCostLoading: false,
  };
};

export const useLoginDepositConfirm = (_params: {
  onGotoGasAccount?: () => void;
}) => useCallback(() => undefined, []);
