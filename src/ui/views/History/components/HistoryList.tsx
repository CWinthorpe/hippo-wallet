import React, { useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQueryDbHistory } from '@/db/hooks/history';
import { useCurrentAccount } from '@/ui/hooks/backgroundState/useAccount';
import { isSupportDBAccount } from '@/utils/account';
import { Virtuoso } from 'react-virtuoso';
import { Empty, Modal } from 'ui/component';
import { HistoryItem, HistoryItemActionContext } from './HistoryItem';
import { Loading } from './Loading';

export const HistoryList = ({
  isFilterScam = false,
}: {
  isFilterScam?: boolean;
}) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  const currentAccount = useCurrentAccount();
  // Only the local db path keeps 90 days; the api path has no window.
  const hasLocalHistory = isSupportDBAccount(currentAccount);

  const { data, loading, loadingMore, loadMore, noMore } = useQueryDbHistory({
    account: currentAccount,
    isFilterScam,
  });

  const isEmpty = !data || data.length === 0;

  const showInitialLoading = loading && isEmpty;

  // Only the local db path keeps 90 days; the api path has no window.
  // Wait for loading to settle so a running sync doesn't show it early.
  const noMoreText =
    noMore && !loading && !loadingMore
      ? hasLocalHistory
        ? t('page.transactions.noMore.titleInLast90Days')
        : t('page.transactions.noMore.title')
      : undefined;

  const [
    focusingHistoryItem,
    setFocusingHistoryItem,
  ] = React.useState<HistoryItemActionContext | null>(null);

  return (
    <div className="overflow-auto h-full" ref={ref}>
      <Modal
        visible={!!focusingHistoryItem}
        // View Message
        title={t('page.transactions.modalViewMessage.title')}
        className="view-tx-message-modal"
        onCancel={() => {
          setFocusingHistoryItem(null);
        }}
        maxHeight="360px"
      >
        <div className="parsed-content text-14">
          {focusingHistoryItem?.parsedInputData}
        </div>
      </Modal>

      {showInitialLoading ? (
        <div>
          {/* {isFilterScam ? (
            <div className="filter-scam-loading-text">
              {t('page.transactions.filterScam.loading')}
            </div>
          ) : null} */}
          <Loading count={4} active />
        </div>
      ) : (
        <>
          {isEmpty ? (
            <Empty
              title={t('page.transactions.empty.title')}
              desc={
                <span>
                  {hasLocalHistory ? (
                    <Trans
                      i18nKey="page.transactions.empty.descThreeMonths"
                      t={t}
                    >
                      No Transaction history in 90 Days on{' '}
                      <Link className="underline" to="/settings/chain-list">
                        supported chains
                      </Link>
                    </Trans>
                  ) : (
                    <Trans i18nKey="page.transactions.empty.desc" t={t}>
                      No transactions found on
                      <Link className="underline" to="/settings/chain-list">
                        supported chains
                      </Link>
                    </Trans>
                  )}
                </span>
              }
              className="pt-[108px]"
            ></Empty>
          ) : (
            <Virtuoso
              style={{
                height: '100%',
              }}
              data={data}
              itemContent={(_, item) => {
                return (
                  // Virtuoso sizes rows by offsetHeight, which leaves out
                  // margins. Keep the 12px row gap inside each row (flow-root
                  // for the card's own margin) so the measured height matches
                  // the layout; otherwise the list jumps by 12px at the bottom.
                  <div className="flow-root">
                    <HistoryItem
                      data={item}
                      key={item._id}
                      onViewInputData={setFocusingHistoryItem}
                    />
                  </div>
                );
              }}
              endReached={noMore ? undefined : loadMore}
              increaseViewportBy={100}
              components={{
                Footer: () => {
                  if (loadingMore) {
                    return <Loading count={2} active />;
                  }
                  if (noMoreText) {
                    return (
                      <div className="flex items-center gap-[8px] pt-[4px] pb-[20px]">
                        <div className="flex-1 h-[1px] bg-r-neutral-line" />
                        <div className="text-center text-[12px] leading-[14px] text-r-neutral-foot">
                          {noMoreText}
                        </div>
                        <div className="flex-1 h-[1px] bg-r-neutral-line" />
                      </div>
                    );
                  }
                  return null;
                },
              }}
            ></Virtuoso>
          )}
        </>
      )}
    </div>
  );
};
