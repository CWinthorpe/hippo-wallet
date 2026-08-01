import React from 'react';
import { Skeleton } from 'antd';

export interface DirectSignGasInfoProps {
  loading?: boolean;
  openShowMore?: any;
  supportDirectSign?: boolean;
  gasMethod?: string;
  gasCostUsd?: string | number;
  [key: string]: unknown;
}

/** Compact selected-RPC gas status shared by direct-sign flows. */
export const DirectSignGasInfo: React.FC<DirectSignGasInfoProps> = ({
  loading,
  openShowMore,
  gasCostUsd,
}) => (
  <button
    type="button"
    className="w-full flex items-center justify-between rounded-[8px] bg-r-neutral-card-1 px-[12px] py-[10px] text-[13px] text-r-neutral-body"
    onClick={openShowMore}
  >
    <span>Network fee</span>
    {loading ? (
      <Skeleton.Button active size="small" />
    ) : (
      <span className="text-r-neutral-title-1">
        {gasCostUsd === undefined || gasCostUsd === null
          ? 'Selected RPC estimate'
          : `$${gasCostUsd}`}
      </span>
    )}
  </button>
);
