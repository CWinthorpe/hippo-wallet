import type { Account } from '@/background/service/preference';
import type { WalletControllerType } from '@/ui/utils';

export const sendCowSwapTransaction = <T = string>(
  wallet: WalletControllerType,
  account: Account,
  chainId: number,
  transaction: Record<string, any>
) =>
  wallet.sendRequest<T>(
    {
      method: 'eth_sendTransaction',
      params: [{ ...transaction, chainId }],
    },
    { account }
  );

export const signCowSwapTypedData = <T = string>(
  wallet: WalletControllerType,
  account: Account,
  chainId: number,
  payload: Record<string, any>
) => {
  if (Number(payload.domain?.chainId) !== chainId) {
    throw new Error('Typed-data chain does not match the selected chain');
  }
  return wallet.sendRequest<T>(
    {
      method: 'eth_signTypedData_v4',
      params: [account.address, JSON.stringify(payload)],
      $ctx: { chainId },
    },
    { account }
  );
};

export const getCowSwapTransactionReceipt = <T = any>(
  wallet: WalletControllerType,
  account: Account,
  chainServerId: string,
  hash: string
) =>
  wallet.requestETHRpc<T>(
    { method: 'eth_getTransactionReceipt', params: [hash] },
    chainServerId,
    account
  );
