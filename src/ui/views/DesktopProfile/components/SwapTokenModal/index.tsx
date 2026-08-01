import { Modal, ModalProps } from 'antd';
import React from 'react';
import Swap from '../../../Swap';
import { ModalCloseIcon } from '../TokenDetailModal';
import { PopupContainer } from '@/ui/hooks/usePopupContainer';

export const SwapTokenModal: React.FC<ModalProps> = (props) => {
  return (
    <Modal
      {...props}
      className="desktop-swap-token-modal modal-support-darkmode"
      width={400}
      title={null}
      bodyStyle={{ background: 'transparent', maxHeight: 'unset', padding: 0 }}
      maskClosable={true}
      centered
      footer={null}
      zIndex={1000}
      closeIcon={ModalCloseIcon}
      destroyOnClose
      maskStyle={{
        zIndex: 1000,
        backdropFilter: 'blur(8px)',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
      }}
    >
      <PopupContainer>
        <div className="js-rabby-desktop-swap-container bg-r-neutral-bg-2 rounded-[20px]">
          <Swap />
        </div>
      </PopupContainer>
    </Modal>
  );
};
