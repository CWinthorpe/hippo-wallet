import { Account } from '@/background/service/preference';
import { KEYRING_CLASS, KEYRING_TYPE } from '@/constant';
import { ReactComponent as RcArrowDownSVG } from '@/ui/assets/dashboard/arrow-down-cc.svg';
import { RcIconCopyCC } from '@/ui/assets/desktop/common';
import { RcIconAddWalletCC } from '@/ui/assets/desktop/profile';
import { useAccounts } from '@/ui/hooks/useAccounts';
import { useBrandIcon } from '@/ui/hooks/useBrandIcon';
import { IDisplayedAccountWithBalance } from '@/ui/models/accountToDisplay';
import { useRabbyDispatch, useRabbySelector } from '@/ui/store';
import { formatUsdValue, splitNumberByStep, useAlias } from '@/ui/utils';
import { isSameAccount, isSupportSmallSwapAccount } from '@/utils/account';
import { useMemoizedFn } from 'ahooks';
import { Popover, Tooltip } from 'antd';
import clsx from 'clsx';
import { flatten } from 'lodash';
import React, { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMount } from 'react-use';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { AddressViewer } from 'ui/component';
import { CopyChecked } from '../CopyChecked';
import './styles.less';

interface DesktopAccountSelectorProps {
  value?: Account | null;
  onChange?(account: Account): void;
  scene?: Scene;
  className?: string;
  disabled?: boolean;
}

type Scene = 'prediction' | 'smallSwap';

export const DesktopAccountSelector: React.FC<DesktopAccountSelectorProps> = ({
  value,
  onChange,
  scene,
  className,
  disabled,
}) => {
  const { t } = useTranslation();

  const dispatch = useRabbyDispatch();

  const [isOpen, setIsOpen] = React.useState(false);
  const handleChange = useMemoizedFn((account: Account) => {
    onChange?.(account);
    setIsOpen(false);
  });

  React.useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false);
    }
  }, [disabled, isOpen]);

  useMount(() => {
    dispatch.addressManagement.getHilightedAddressesAsync().then(() => {
      dispatch.accountToDisplay.getAllAccountsToDisplay();
    });
  });

  return (
    <>
      <Popover
        placement="bottomRight"
        trigger={['hover']}
        overlayClassName={'desktop-account-selector-popover'}
        content={
          <AccountList
            scene={scene}
            selectedAccount={value}
            onSelectAccount={handleChange}
            onClose={() => {
              setIsOpen(false);
            }}
          />
        }
        visible={disabled ? false : isOpen}
        onVisibleChange={(visible) => {
          if (disabled) {
            return;
          }
          setIsOpen(visible);
        }}
        destroyTooltipOnHide
      >
        <div
          aria-disabled={disabled}
          aria-expanded={isOpen}
          className={clsx(
            'h-[32px] pl-[12px] px-[10px] rounded-[8px]',
            'flex items-center gap-[6px]',
            'border border-rb-neutral-line',
            disabled
              ? 'cursor-not-allowed opacity-50'
              : 'cursor-pointer hover:bg-rb-brand-light-1 hover:border-rb-brand-default',
            className
          )}
        >
          {value ? (
            <CurrentAccount account={value} />
          ) : (
            <div className="flex-1 text-[13px] leading-[16px] font-medium text-rb-neutral-title-1">
              {t('component.DesktopAccountSelector.selectAddress')}
            </div>
          )}
          <RcArrowDownSVG
            viewBox="0 0 14 14"
            className={clsx('w-[14px] h-[14px] text-r-neutral-foot')}
          />
        </div>
      </Popover>
    </>
  );
};

const CurrentAccount = ({ account }: { account: Account }) => {
  const addressTypeIcon = useBrandIcon({
    address: account.address,
    brandName: account.brandName,
    type: account.type,
    forceLight: false,
  });

  const [alias] = useAlias(account.address);

  return (
    <>
      <img src={addressTypeIcon} className="w-[16px] h-[16px]" alt="" />
      <div className="flex-1 text-[13px] leading-[16px] font-medium text-rb-neutral-title-1">
        {alias}
      </div>
    </>
  );
};

const useAccountList = () => {
  const { sortedAccountsList, fetchAllAccounts } = useAccounts();
  const filteredAccounts = useMemo(() => {
    return flatten(sortedAccountsList).filter(
      (item) => item.type !== KEYRING_TYPE.WatchAddressKeyring
    );
  }, [sortedAccountsList]);

  useMount(() => {
    if (!sortedAccountsList.length) {
      fetchAllAccounts();
    }
  });

  return {
    accounts: filteredAccounts,
  };
};

const AccountList: React.FC<{
  scene?: Scene;
  onSelectAccount?(account: Account): void;
  selectedAccount?: Account | null;
  onClose?(): void;
}> = ({ onSelectAccount, selectedAccount, scene, onClose }) => {
  const { accounts } = useAccountList();

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const { t } = useTranslation();

  const height = useMemo(() => {
    return Math.min(accounts.length + 1, 8) * 74 - 12;
  }, [accounts.length]);

  const hasScrollbar = useMemo(() => {
    return accounts.length + 1 > 8;
  }, [accounts.length]);

  const dispatch = useRabbyDispatch();

  // useEffect(() => {
  //   setTimeout(() => {
  //     const index = accounts.findIndex((item) =>
  //       selectedAccount ? isSameAccount(item, selectedAccount) : false
  //     );
  //     if (index !== -1) {
  //       virtuosoRef.current?.scrollToIndex({
  //         index: index,
  //         align: 'start',
  //       });
  //     }
  //   }, 200);
  // }, [accounts]);

  return (
    <div
      className={clsx(
        'py-[12px] pl-[12px]',
        hasScrollbar ? 'pr-[4px]' : 'pr-[12px]'
      )}
    >
      <Virtuoso
        ref={virtuosoRef}
        className={'w-[300px]'}
        style={{ height: height }}
        data={accounts}
        totalCount={accounts.length}
        defaultItemHeight={72 + 12}
        itemContent={(index, item) => {
          const isSelected = selectedAccount
            ? isSameAccount(item, selectedAccount)
            : false;

          const disabled =
            scene === 'smallSwap' && !isSupportSmallSwapAccount(item);

          return (
            <div
              key={`${item.address}-${item.type}-${item.brandName}`}
              className={clsx(hasScrollbar ? 'pr-[4px]' : '')}
            >
              <AccountItem
                onClick={() => {
                  onSelectAccount?.(item);
                }}
                isSelected={isSelected}
                item={item}
                // isLast={isLast}
                tips={
                  disabled
                    ? t(
                        'component.DesktopSelectAccountList.smallSwapDisabledTips'
                      )
                    : undefined
                }
                disabled={disabled}
                scene={scene}
              >
                {item.address}
              </AccountItem>
            </div>
          );
        }}
        components={{
          Footer: () => (
            <div
              onClick={() => {
                dispatch.desktopProfile.setField({
                  addAddress: {
                    visible: true,
                    importType: '',
                    state: {},
                  },
                });
                onClose?.();
              }}
              className={clsx(
                'cursor-pointer rounded-[12px] h-[62px] p-[16px] flex items-center gap-[8px] text-rb-neutral-body',
                'desktop-account-item',
                'bg-rb-neutral-bg-3 hover:bg-rb-neutral-bg-2'
              )}
            >
              <RcIconAddWalletCC className="shrink-0" />
              <div className="text-[16px] leading-[19px] font-normal desktop-account-item-content truncate">
                {t('component.DesktopSelectAccountList.addAddresses')}
              </div>
            </div>
          ),
        }}
      />
    </div>
  );
};

const AccountItem: React.FC<{
  scene?: Scene;
  item: IDisplayedAccountWithBalance;
  onClick?(): void;
  isSelected?: boolean;
  isLast?: boolean;

  children?: React.ReactNode;
  tips?: string;
  disabled?: boolean;
}> = ({
  item,
  onClick,
  isSelected,
  isLast,

  scene,
  disabled,
  tips,
}) => {
  const { t } = useTranslation();
  const addressTypeIcon = useBrandIcon({
    ...item,
  });

  return (
    <Tooltip title={tips} overlayClassName="rectangle">
      <div className={clsx(!isLast ? 'pb-[12px]' : '', 'group min-h-[1px]')}>
        <div
          className={clsx(
            'rounded-[12px] px-[12px] py-[11px] cursor-pointer flex items-center gap-[8px] min-h-[62px]',
            'border-solid border-[0.5px]',
            'desktop-account-item',
            isSelected
              ? 'border-transparent bg-r-blue-light-2'
              : 'border-rb-neutral-line hover:bg-rb-neutral-bg-2',
            disabled ? 'cursor-not-allowed opacity-50' : ''
          )}
          onClick={disabled ? undefined : onClick}
        >
          <img
            src={addressTypeIcon}
            className={clsx('w-[24px] h-[24px]')}
            alt=""
          />
          <div className="flex flex-1 flex-col gap-[2px] min-w-0 desktop-account-item-content">
            <div className="flex items-center gap-[4px]">
              <div
                className={clsx(
                  'truncate flex-1',
                  isSelected
                    ? 'text-[16px] leading-[19px] font-bold text-rb-neutral-title-1'
                    : 'text-[16px] text-rb-neutral-body leading-[19px] font-medium'
                )}
              >
                {item.alianName}
              </div>
            </div>
            <div className="flex items-center">
              <AddressViewer
                address={item.address?.toLowerCase()}
                showArrow={false}
                className={clsx(
                  isSelected
                    ? 'text-[12px] leading-[14px] text-rb-neutral-title-1'
                    : 'text-[12px] leading-[14px] text-rb-neutral-foot'
                )}
              />
              <CopyChecked
                copyIcon={RcIconCopyCC}
                addr={item.address}
                className={clsx('w-[16px] h-[16px] ml-[2px] text-14')}
                copyClassName={clsx(
                  isSelected
                    ? 'text-rb-neutral-foot'
                    : 'text-rb-neutral-secondary'
                )}
                checkedClassName={clsx('text-rb-green-default')}
              />
              <div
                className={clsx(
                  'ml-[10px] truncate flex-1 block',
                  isSelected
                    ? 'text-[12px] leading-[14px] text-rb-neutral-title-1'
                    : 'text-[12px] leading-[14px]  text-rb-neutral-foot'
                )}
              >
                ${splitNumberByStep(item.balance?.toFixed(2))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Tooltip>
  );
};
