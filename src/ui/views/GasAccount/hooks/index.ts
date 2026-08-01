import { useCallback } from 'react';

export const useGasAccountSign = () => ({
  sig: '',
  accountId: '',
  account: undefined,
  pendingHardwareAccount: undefined as { address: string } | undefined,
  autoLoginAccount: undefined as { address: string } | undefined,
  accountsWithGasAccountBalance: [],
});

export const useGasAccountInfo = () => ({
  value: undefined as any,
  loading: false,
  refresh: async () => undefined,
});

export const useGasAccountInfoV2 = (_options?: {
  address?: string;
  enabled?: boolean;
}) => ({
  value: undefined as any,
  loading: false,
  refresh: async () => undefined,
});

export const useGasAccountLogin = (_state?: unknown) => ({ isLogin: false });

export const useGasAccountMethods = () => ({
  login: useCallback(async () => undefined, []),
  logout: useCallback(async () => undefined, []),
});
