import { Modal, ModalProps } from 'antd';
import React from 'react';
import Receive from '../../../Receive';

export const ReceiveTokenModal: React.FC<ModalProps> = (props) => {
  const { ...modalProps } = props;

  return (
    <Modal
      {...modalProps}
      width={400}
      title={null}
      className="modal-support-darkmode"
      bodyStyle={{
        background: 'transparent',
        maxHeight: '600px',
        height: '600px',
        padding: 0,
      }}
      closable={false}
      maskClosable={true}
      footer={null}
      zIndex={1000}
      maskStyle={{
        zIndex: 1000,
        backdropFilter: 'blur(8px)',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
      }}
    >
      <Receive />
    </Modal>
  );
};
