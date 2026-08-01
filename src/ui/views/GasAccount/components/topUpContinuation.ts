import { useWallet } from '@/ui/utils';
import { Tx } from '@rabby-wallet/rabby-api/dist/types';

export type GasAccountTopUpResult = {
  type: 'token';
  ownerAddress: string;
  chainServerId: string;
};

export type GasAccountTopUpWaitCallback = (
  result: GasAccountTopUpResult
) => Promise<void> | void;

export const shouldUpdateOriginalTxNonceAfterTopUp = (_params: {
  originalAccountAddress: string;
  originalChainServerId: string;
  topUpResult: GasAccountTopUpResult;
}) => false;

export const getBumpedNonceAfterTopUp = async ({
  currentNonce,
}: {
  currentNonce?: string;
  originalAccountAddress: string;
  originalChainServerId: string;
  topUpResult: GasAccountTopUpResult;
  wallet: ReturnType<typeof useWallet>;
}) => currentNonce;

export const buildTopUpResumedTxs = async ({
  txs,
}: {
  txs: Tx[];
  originalAccountAddress: string;
  originalChainServerId: string;
  topUpResult: GasAccountTopUpResult;
  wallet: ReturnType<typeof useWallet>;
}) => txs;
