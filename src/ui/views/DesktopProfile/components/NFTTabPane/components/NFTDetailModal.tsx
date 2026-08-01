import { CollectionList, NFTItem } from '@rabby-wallet/rabby-api/dist/types';
import { Button, Modal, ModalProps } from 'antd';
import React from 'react';
import NFTAvatar from '@/ui/views/Dashboard/components/NFT/NFTAvatar';
import { findChain } from '@/utils/chain';

export type NFTDetailModalProps = ModalProps & {
  nft?: NFTItem;
  collection?: Omit<CollectionList, 'nft_list'>;
  onSend?: () => void;
};

export const NFTDetailModal: React.FC<NFTDetailModalProps> = ({
  nft,
  collection,
  onSend,
  ...modalProps
}) => {
  const chain = findChain({ serverId: nft?.chain });
  return (
    <Modal
      {...modalProps}
      title={nft?.name || 'NFT'}
      footer={null}
      width={520}
      destroyOnClose
    >
      <div className="flex gap-[16px]">
        <NFTAvatar
          className="w-[240px] h-[240px] rounded-[8px]"
          type={nft?.content_type}
          content={nft?.content}
        />
        <div className="flex-1 min-w-0 text-[13px] text-r-neutral-body">
          <div className="mb-[12px]">
            <div className="text-r-neutral-foot">Collection</div>
            <div className="mt-[4px] text-r-neutral-title-1 break-all">
              {collection?.name || '-'}
            </div>
          </div>
          <div className="mb-[12px]">
            <div className="text-r-neutral-foot">Network</div>
            <div className="mt-[4px] text-r-neutral-title-1">
              {chain?.name || nft?.chain || '-'}
            </div>
          </div>
          <div className="mb-[20px]">
            <div className="text-r-neutral-foot">Token ID</div>
            <div className="mt-[4px] text-r-neutral-title-1 break-all">
              {nft?.inner_id || nft?.id || '-'}
            </div>
          </div>
          <Button block type="primary" onClick={onSend}>
            Send NFT
          </Button>
        </div>
      </div>
      <div className="mt-[16px] text-[12px] text-r-neutral-foot">
        Hippo provides viewing and transfer only. Listings, offers, sales, and
        marketplace execution are not included.
      </div>
    </Modal>
  );
};

export default NFTDetailModal;
