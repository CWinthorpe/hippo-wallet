import React from 'react';
import { DrawerProps } from 'antd';

interface GasAccountDepositPopupProps {
  visible?: boolean;
  onCancel?(): void;
  onClose?(): void;
  onDeposit?(): Promise<void> | void;
  onWaitDepositResult?: (...args: any[]) => any;
  minDepositPrice?: number;
  disableDirectDeposit?: boolean;
  maxAccountCount?: number;
  getContainer?: DrawerProps['getContainer'];
}

/** Sponsored-gas top ups were removed from Hippo Wallet. */
export const GasAccountDepositPopup: React.FC<GasAccountDepositPopupProps> = () =>
  null;
