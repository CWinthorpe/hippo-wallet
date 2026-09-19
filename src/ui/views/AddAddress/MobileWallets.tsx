import clsx from 'clsx';
import React from 'react';
import { Tooltip } from 'antd';
import { useHistory, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Item, PageHeader } from '@/ui/component';
import { useAddAddressWalletOptions } from './shared';
import IconWalletConnect from 'ui/assets/walletlogo/walletconnect.svg';

export const MobileWallets: React.FC<{
  isInModal?: boolean;
  onBack?(): void;
  onNavigate?(type: string, state?: Record<string, any>): void;
}> = ({ isInModal, onBack, onNavigate }) => {
  const history = useHistory();
  const { t } = useTranslation();
  // See AddAddressOptions/index.tsx for why this is read/forwarded.
  const { approvalId } = (useLocation().state as { approvalId?: string }) || {};
  const { mobileWallets } = useAddAddressWalletOptions({
    onNavigate,
    params: { approvalId },
  });

  const handleBack = React.useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    history.goBack();
  }, [history, onBack]);

  return (
    <div
      className={clsx(
        'bg-r-neutral-bg-2 flex flex-col overflow-hidden px-[20px]',
        isInModal ? 'h-[600px]' : 'min-h-full'
      )}
    >
      <PageHeader fixed className="pt-[20px]" forceShowBack onBack={handleBack}>
        {t('page.newAddress.connectMobileWalletApps')}
      </PageHeader>

      <div className="mb-[12px] rounded-[8px] bg-r-neutral-card-2 px-[12px] py-[10px] text-[12px] leading-[16px] text-r-neutral-foot">
        Mobile wallets connect through WalletConnect. Pairing metadata uses this
        fork's operator-owned Reown project, never the upstream project's
        identity.
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-[20px]">
        <div className="flex flex-col gap-[12px]">
          {mobileWallets.map((wallet) => {
            const row = (
              <Item
                key={wallet.brand}
                onClick={wallet.onClick}
                disabled={wallet.preventClick}
                px={16}
                py={0}
                bgColor="var(--r-neutral-card-1, #fff)"
                className={clsx(
                  'h-[52px] rounded-[8px]',
                  wallet.preventClick
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer'
                )}
                left={
                  <div className="relative mr-[12px] flex h-[24px] w-[24px] shrink-0 items-center justify-center">
                    <img
                      src={wallet.image}
                      alt={wallet.content}
                      className="h-[24px] w-[24px] shrink-0"
                    />
                    {wallet.image !== IconWalletConnect && (
                      <img
                        src={IconWalletConnect}
                        alt="WalletConnect"
                        className="absolute -bottom-[4px] -right-[5px] h-[12px] w-[12px] rounded-full"
                      />
                    )}
                  </div>
                }
              >
                <div className="flex-1 text-[15px] font-medium leading-[18px] text-r-neutral-title-1">
                  {wallet.content}
                </div>
              </Item>
            );

            if (wallet.tipI18nKey) {
              return (
                <Tooltip
                  key={wallet.brand}
                  title={t(wallet.tipI18nKey)}
                  placement="topLeft"
                  overlayClassName="rectangle w-[max-content] max-w-[355px]"
                >
                  <div>{row}</div>
                </Tooltip>
              );
            }

            return row;
          })}
        </div>
      </div>
    </div>
  );
};
