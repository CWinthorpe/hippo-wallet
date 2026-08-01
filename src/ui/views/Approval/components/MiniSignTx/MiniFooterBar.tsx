import { Account } from '@/background/service/preference';
import { useThemeMode } from '@/ui/hooks/usePreference';
import { useWallet } from '@/ui/utils';
import { Chain } from '@debank/common';
import { Result } from '@rabby-wallet/rabby-security-engine';
import { Level } from '@rabby-wallet/rabby-security-engine/dist/rules';
import clsx from 'clsx';
import { KEYRING_CLASS, SecurityEngineLevel } from 'consts';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { Props as ActionGroupProps } from '../FooterBar/ActionGroup';
import { MiniCommonAction } from './MiniCommonAction';
import { MiniLedgerAction } from './MiniLedgerAction';
import { MiniOneKeyAction } from './MiniOneKeyAction';
import { BatchSignTxTaskType } from './useBatchSignTxTask';
import { DrawerProps } from 'antd';

interface Props extends Omit<ActionGroupProps, 'account'> {
  chain?: Chain;
  gnosisAccount?: Account;
  securityLevel?: Level;
  origin?: string;
  originLogo?: string;
  hasUnProcessSecurityResult?: boolean;
  hasShadow?: boolean;
  isTestnet?: boolean;
  engineResults?: Result[];
  onIgnoreAllRules(): void;
  useGasLess?: boolean;
  showGasLess?: boolean;
  enableGasLess?: () => void;
  canUseGasLess?: boolean;
  Header?: React.ReactNode;
  Main?: React.ReactNode;
  gasLessFailedReason?: string;
  isWatchAddr?: boolean;
  gasLessConfig?: Record<string, unknown>;
  isGasNotEnough?: boolean;
  task: BatchSignTxTaskType;
  gasMethod?: 'native' | 'gasAccount';
  gasAccountCost?: unknown;
  onChangeGasAccount?: () => void | Promise<void>;
  isGasAccountLogin?: boolean;
  isWalletConnect?: boolean;
  gasAccountCanPay?: boolean;
  noCustomRPC?: boolean;
  canGotoUseGasAccount?: boolean;
  canDepositUseGasAccount?: boolean;
  gasAccountAddress?: string;
  onOpenGasAccountDeposit?: () => void;
  disableGasAccountDeposit?: boolean;
  getContainer?: DrawerProps['getContainer'];
  isFirstGasCostLoading?: boolean;
  isFirstGasLessLoading?: boolean;
  disableAutoGasAccountSwitch?: boolean;
  directSubmit?: boolean;
  account?: Account;
  disableSignBtn?: boolean;
  onRedirectToDeposit?: () => void;
  className?: string;
}

const Wrapper = styled.section`
  padding: 12px 20px 20px;
  border-radius: 16px 16px 0 0;
  background: var(--r-neutral-bg-1, #3d4251);
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.1);
  position: relative;

  &.is-darkmode {
    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
  }

  .security-level-tip {
    margin-top: 10px;
    border-radius: 4px;
    padding: 6px 10px 6px 8px;
    font-weight: 500;
    font-size: 13px;
    line-height: 15px;
    display: flex;
  }
`;

const Shadow = styled.div<{ isShow: boolean }>`
  pointer-events: none;
  position: absolute;
  top: -85px;
  height: 100px;
  left: 0;
  width: 100%;
  background: linear-gradient(
    180deg,
    rgba(217, 217, 217, 0) 10.74%,
    rgba(175, 175, 175, 0.168147) 41.66%,
    rgba(130, 130, 130, 0.35) 83.44%
  );
  z-index: 0;
  opacity: ${(props) => (props.isShow ? 1 : 0)};
`;

const SecurityLevelTipColor = {
  [Level.FORBIDDEN]: {
    bg: 'var(--r-red-light-2, #EFD4D1)',
    text: 'var(--r-red-dark, #AE2A19)',
    icon: SecurityEngineLevel[Level.FORBIDDEN].icon,
  },
  [Level.DANGER]: {
    bg: 'var(--r-red-light, #FFDFDB)',
    text: 'var(--r-red-default, #E34935)',
    icon: SecurityEngineLevel[Level.DANGER].icon,
  },
  [Level.WARNING]: {
    bg: 'var(--r-orange-light, #FFEDCB)',
    text: 'var(--r-orange-default, #FFB020)',
    icon: SecurityEngineLevel[Level.WARNING].icon,
  },
};

export const MiniFooterBar: React.FC<Props> = ({
  gnosisAccount,
  securityLevel,
  hasUnProcessSecurityResult,
  hasShadow = false,
  onIgnoreAllRules,
  Header,
  Main,
  task,
  getContainer,
  directSubmit,
  account: propsAccount,
  disableSignBtn = false,
  className,
  ...props
}) => {
  const [account, setAccount] = React.useState<Account>();
  const wallet = useWallet();
  const { t } = useTranslation();
  const { isDarkTheme } = useThemeMode();

  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      const currentAccount =
        propsAccount || gnosisAccount || (await wallet.syncGetCurrentAccount());
      if (mounted && currentAccount) setAccount(currentAccount);
    })();
    return () => {
      mounted = false;
    };
  }, [gnosisAccount, propsAccount, wallet]);

  if (!account) return null;

  const footer =
    securityLevel && hasUnProcessSecurityResult ? (
      <div
        className="security-level-tip"
        style={{
          color: SecurityLevelTipColor[securityLevel].bg,
          backgroundColor: SecurityLevelTipColor[securityLevel].bg,
        }}
      >
        <img
          src={SecurityLevelTipColor[securityLevel].icon}
          className="icon icon-level"
        />
        <span
          className="flex-1"
          style={{ color: SecurityLevelTipColor[securityLevel].text }}
        >
          {t('page.signFooterBar.processRiskAlert')}
        </span>
        <span
          className="underline text-13 font-medium cursor-pointer"
          style={{ color: SecurityLevelTipColor[securityLevel].text }}
          onClick={onIgnoreAllRules}
        >
          {t('page.signFooterBar.ignoreAll')}
        </span>
      </div>
    ) : null;

  const MiniHardwareAction =
    account.type === KEYRING_CLASS.HARDWARE.LEDGER
      ? MiniLedgerAction
      : MiniOneKeyAction;
  const disabledProcess = disableSignBtn || props.disabledProcess;

  return (
    <div className="relative">
      {!isDarkTheme && <Shadow isShow={hasShadow} />}
      <Wrapper className={clsx({ 'is-darkmode': hasShadow }, className)}>
        {Header}
        {Main}
        <div className="pt-[10px]">
          {[
            KEYRING_CLASS.HARDWARE.LEDGER,
            KEYRING_CLASS.HARDWARE.ONEKEY,
          ].includes(account.type) ? (
            <MiniHardwareAction
              {...(props as ActionGroupProps)}
              directSubmit={directSubmit}
              isMiniSignTx
              task={task}
              account={account}
              gasLess={false}
              disabledProcess={disabledProcess}
              enableTooltip={props.enableTooltip}
              footer={footer}
              getContainer={getContainer}
            />
          ) : (
            <MiniCommonAction
              {...(props as ActionGroupProps)}
              directSubmit={directSubmit}
              isMiniSignTx
              task={task}
              account={account}
              gasLess={false}
              disabledProcess={disabledProcess}
              enableTooltip={props.enableTooltip}
              footer={footer}
            />
          )}
        </div>
      </Wrapper>
    </div>
  );
};
