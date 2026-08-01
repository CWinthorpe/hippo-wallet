import { useCurrentAccount } from '@/ui/hooks/backgroundState/useAccount';
import { useNFTCollections } from '@/ui/hooks/useNFTCollections';
import { CollectionList, NFTItem } from '@rabby-wallet/rabby-api/dist/types';
import { Skeleton, Switch } from 'antd';
import clsx from 'clsx';
import { omit, range } from 'lodash';
import React from 'react';
import { NFTCardItem } from './components/NFTCardItem';
import { NFTDetailModal } from './components/NFTDetailModal';
import { useHistory } from 'react-router-dom';
import { useListenTxReload } from '../../hooks/useListenTxReload';
import { useTranslation } from 'react-i18next';
import { EmptyIcon } from '../TokensTabPane/TokenListEmpty';

export const NFTTabPane: React.FC<{ selectChainId?: string }> = ({
  selectChainId,
}) => {
  const { t } = useTranslation();
  const history = useHistory();
  const currentAccount = useCurrentAccount();
  const [isAll, setIsAll] = React.useState(false);
  const [current, setCurrent] = React.useState<{
    nft: NFTItem;
    collection?: Omit<CollectionList, 'nft_list'>;
  }>();
  const { collections, isLoading: loading, refresh } = useNFTCollections(
    currentAccount?.address
  );

  const list = React.useMemo(() => {
    const result: {
      nft: NFTItem;
      collection: Omit<CollectionList, 'nft_list'>;
    }[] = [];
    collections.forEach((collection) => {
      if (selectChainId && collection.chain !== selectChainId) return;
      if (!isAll && (collection.is_hidden || !collection.is_core)) return;
      const baseCollection = omit(collection, 'nft_list');
      collection.nft_list.forEach((nft) =>
        result.push({ nft, collection: baseCollection })
      );
    });
    return result.sort(
      (a, b) =>
        (b.collection.credit_score || 0) - (a.collection.credit_score || 0)
    );
  }, [collections, isAll, selectChainId]);

  useListenTxReload(refresh);

  return (
    <div className="py-[16px] px-[20px]">
      {loading ? (
        <div className="flex items-center justify-between mb-[16px]">
          <Skeleton.Input className="w-[100px] h-[30px] rounded-[4px]" active />
          <Skeleton.Input className="w-[198px] h-[30px] rounded-[4px]" active />
        </div>
      ) : (
        <header className="flex items-center justify-between mb-[16px]">
          <div className="rounded-[10px] p-[2px] bg-rb-neutral-bg-0">
            <div className="py-[6px] px-[12px] rounded-[8px] bg-rb-neutral-foot dark:bg-rb-neutral-bg-4 text-rb-neutral-InvertHighlight text-[12px] leading-[14px] font-medium">
              {t('page.desktopProfile.nft.all')} ({list.length})
            </div>
          </div>
          <label className="flex items-center gap-[6px] cursor-pointer">
            <Switch checked={!isAll} onChange={(value) => setIsAll(!value)} />
            <div className="text-rb-neutral-title-1 text-[14px] leading-[17px]">
              {t('page.desktopProfile.nft.hideLowValue')}
            </div>
          </label>
        </header>
      )}

      <main>
        <div className="flex items-center flex-wrap gap-[12px]">
          {loading ? (
            range(10).map((item) => (
              <Skeleton.Input
                key={item}
                className="w-[198px] h-[220px] rounded-[4px]"
                active
              />
            ))
          ) : list.length ? (
            list.map((item) => (
              <NFTCardItem
                key={`${item.nft.id}-${item.nft.chain}-${item.collection.id}`}
                item={item}
                onClick={() => setCurrent(item)}
              />
            ))
          ) : (
            <div className="w-full py-[160px] flex flex-col items-center justify-center gap-[8px]">
              <EmptyIcon />
              <div className="text-r-neutral-foot text-[13px] leading-[16px] font-medium">
                {t('page.desktopProfile.nft.empty')}
              </div>
            </div>
          )}
        </div>
      </main>

      <NFTDetailModal
        visible={!!current}
        nft={current?.nft}
        collection={current?.collection}
        onCancel={() => setCurrent(undefined)}
        onSend={() => {
          if (!current) return;
          const query = new URLSearchParams();
          query.set('nftItem', encodeURIComponent(JSON.stringify(current.nft)));
          query.set('action', 'send');
          query.set('sendPageType', 'sendNft');
          history.replace(`${history.location.pathname}?${query.toString()}`);
          setCurrent(undefined);
        }}
      />
    </div>
  );
};
