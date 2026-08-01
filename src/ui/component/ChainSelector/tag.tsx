import React, { useState } from 'react';
import { CHAINS_ENUM } from 'consts';
import { SvgIconArrowDownTriangle } from 'ui/assets';
import Modal from './Modal';

import './style.less';
import { SelectChainListProps } from './components/SelectChainList';

import { findChainByEnum } from '@/utils/chain';

interface ChainSelectorProps {
  value: CHAINS_ENUM;
  onChange?(value: CHAINS_ENUM): void;
  readonly?: boolean;
  showModal?: boolean;
  direction?: 'top' | 'bottom';
  supportChains?: SelectChainListProps['supportChains'];
  disabledTips?: SelectChainListProps['disabledTips'];
  title?: React.ReactNode;
}

const ChainSelector = ({
  value,
  onChange,
  readonly = false,
  showModal = false,
  supportChains,
}: ChainSelectorProps) => {
  const [showSelectorModal, setShowSelectorModal] = useState(showModal);

  const handleClickSelector = () => {
    if (readonly) return;
    setShowSelectorModal(true);
  };

  const handleCancel = () => {
    if (readonly) return;
    setShowSelectorModal(false);
  };

  const handleChange = (value: CHAINS_ENUM) => {
    if (readonly) return;
    onChange && onChange(value);
    setShowSelectorModal(false);
  };

  return (
    <>
      <div className="chain-tag-selector" onClick={handleClickSelector}>
        On{' '}
        <span className="chain-tag-selector__name flex-1">
          {findChainByEnum(value)?.name || ''}
        </span>
        {!readonly && (
          <SvgIconArrowDownTriangle className="icon icon-arrow-down" />
        )}
      </div>
      {!readonly && (
        <Modal
          value={value}
          visible={showSelectorModal}
          onChange={handleChange}
          onCancel={handleCancel}
          supportChains={supportChains}
        />
      )}
    </>
  );
};

export default ChainSelector;
