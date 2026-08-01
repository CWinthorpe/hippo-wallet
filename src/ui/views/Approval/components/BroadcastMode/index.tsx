import React, { useEffect } from 'react';
import { CHAINS_ENUM } from '@debank/common';
import { TxPushType } from '@rabby-wallet/rabby-api/dist/types';
import { Account } from '@/background/service/preference';

interface BroadcastModeProps {
  value: {
    type: TxPushType;
    lowGasDeadline?: number;
  };
  onChange?: (value: { type: TxPushType; lowGasDeadline?: number }) => void;
  className?: string;
  style?: React.CSSProperties;
  chain: CHAINS_ENUM;
  isSpeedUp?: boolean;
  isCancel?: boolean;
  isGasTopUp?: boolean;
  account: Account;
}

/**
 * Hippo routes broadcasts centrally: custom RPC first, otherwise guarded
 * MEV Blocker on eligible Ethereum mainnet transactions. There is no backend
 * broadcast-mode negotiation or low-gas queue.
 */
export const BroadcastMode = ({ value, onChange }: BroadcastModeProps) => {
  useEffect(() => {
    if (value?.type !== 'default') {
      onChange?.({ type: 'default' });
    }
  }, [onChange, value?.type]);

  return null;
};
