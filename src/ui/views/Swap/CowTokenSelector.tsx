import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import type { TokenItem } from '@/background/service/openapi';
import TokenSelector from '@/ui/component/TokenSelector';
import { usePopupContainer } from '@/ui/hooks/usePopupContainer';
import { useRabbySelector } from '@/ui/store';
import { useTokens } from '@/ui/utils/portfolio/token';
import { abstractTokenToTokenItem } from '@/ui/utils/token';
import { useWallet } from '@/ui/utils';
import { findChain } from '@/utils/chain';
import {
  cowSwapMetadataToTokenItem,
  getCowSwapStandardTokens,
  getCowSwapTokenAddress,
  isRiskyCowSwapToken,
  matchesCowSwapTokenQuery,
  mergeCowSwapTokenLists,
} from './cowSwapTokens';

interface CowTokenSelectorProps {
  visible: boolean;
  mode: 'sell' | 'buy';
  accountAddress: string;
  chainServerId: string;
  selectedTokens: TokenItem[];
  excludedAddress?: string;
  onSelect: (token: TokenItem) => void;
  onClose: () => void;
}

const CowTokenSelector = ({
  visible,
  mode,
  accountAddress,
  chainServerId,
  selectedTokens,
  excludedAddress,
  onSelect,
  onClose,
}: CowTokenSelectorProps) => {
  const wallet = useWallet();
  const { getContainer } = usePopupContainer();
  const [query, setQuery] = useState('');
  const [remoteSearchTokens, setRemoteSearchTokens] = useState<TokenItem[]>([]);
  const [rpcSearchTokens, setRpcSearchTokens] = useState<TokenItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [portfolioDiscoveryEnabled, setPortfolioDiscoveryEnabled] = useState(
    false
  );
  const searchGenerationRef = useRef(0);
  const chain = useMemo(() => findChain({ serverId: chainServerId }), [
    chainServerId,
  ]);
  const standardTokens = useMemo(
    () => getCowSwapStandardTokens(chainServerId),
    [chainServerId]
  );
  useEffect(() => {
    let active = true;
    void wallet
      .getRemoteDataPolicy()
      .then((policy) => {
        if (active) {
          setPortfolioDiscoveryEnabled(Boolean(policy.capabilities.portfolio));
        }
      })
      .catch(() => {
        if (active) setPortfolioDiscoveryEnabled(false);
      });
    return () => {
      active = false;
    };
  }, [wallet]);
  const { isLoading: walletTokensLoading } = useTokens(
    portfolioDiscoveryEnabled ? accountAddress : undefined,
    {
      visible,
      chainServerId,
      realtimeMode: true,
      disableRecommended: true,
    }
  );
  const accountTokens = useRabbySelector((state) => state.account.tokens.list);
  const walletTokens = useMemo(
    () =>
      portfolioDiscoveryEnabled && !walletTokensLoading
        ? accountTokens
            .map(abstractTokenToTokenItem)
            .filter((token) => token.chain === chainServerId)
        : [],
    [
      accountTokens,
      chainServerId,
      portfolioDiscoveryEnabled,
      walletTokensLoading,
    ]
  );
  const baseTokens = useMemo(
    () =>
      mergeCowSwapTokenLists(
        [selectedTokens, walletTokens, standardTokens],
        chainServerId,
        excludedAddress
      ),
    [
      walletTokens,
      standardTokens,
      selectedTokens,
      chainServerId,
      excludedAddress,
    ]
  );

  useEffect(() => {
    const keyword = query.trim();
    const generation = ++searchGenerationRef.current;
    if (!visible || !keyword) {
      setRemoteSearchTokens([]);
      setRpcSearchTokens([]);
      setSearchLoading(false);
      return;
    }

    const exactAddress = ethers.utils.isAddress(keyword);
    setSearchLoading(true);
    setRemoteSearchTokens([]);
    setRpcSearchTokens([]);
    const remoteSearches: Array<Promise<TokenItem[]>> = [];
    if (portfolioDiscoveryEnabled) {
      remoteSearches.push(
        Promise.resolve().then(() =>
          wallet.openapi
            .searchToken(accountAddress, keyword, chainServerId, exactAddress)
            .then((items) =>
              (items || []).filter(
                (token) => exactAddress || mode === 'buy' || token.amount > 0
              )
            )
        )
      );
    }

    if (portfolioDiscoveryEnabled && mode === 'buy') {
      remoteSearches.push(
        Promise.resolve().then(() =>
          wallet.openapi.searchTokensV2({
            q: keyword,
            chain_id: chainServerId,
          })
        )
      );
    }

    let rpcSearch: Promise<TokenItem[]> = Promise.resolve([]);
    if (exactAddress) {
      const normalizedAddress = ethers.utils.getAddress(keyword).toLowerCase();
      const source = baseTokens.find((token) => {
        try {
          return (
            getCowSwapTokenAddress(token, chainServerId) === normalizedAddress
          );
        } catch {
          return false;
        }
      });
      rpcSearch = Promise.resolve()
        .then(() =>
          wallet.getCowSwapTokenMetadata({
            chainServerId,
            tokenAddress: normalizedAddress,
            ownerAddress: accountAddress,
          })
        )
        .then((metadata) => [
          cowSwapMetadataToTokenItem(metadata, chainServerId, source),
        ]);
      void rpcSearch.then(
        (items) => {
          if (searchGenerationRef.current === generation) {
            setRpcSearchTokens(items);
          }
        },
        () => undefined
      );
    }

    void Promise.allSettled(remoteSearches).then((results) => {
      if (searchGenerationRef.current !== generation) return;
      setRemoteSearchTokens(
        results.flatMap((result) =>
          result.status === 'fulfilled' ? result.value : []
        )
      );
    });
    void Promise.allSettled([rpcSearch, ...remoteSearches]).then(() => {
      if (searchGenerationRef.current !== generation) return;
      setSearchLoading(false);
    });
  }, [
    accountAddress,
    baseTokens,
    chainServerId,
    mode,
    portfolioDiscoveryEnabled,
    query,
    visible,
    wallet,
  ]);

  const displayTokens = useMemo(() => {
    if (!query.trim()) return baseTokens;
    const localMatches = baseTokens.filter((token) =>
      matchesCowSwapTokenQuery(token, query)
    );
    return mergeCowSwapTokenLists(
      [rpcSearchTokens, remoteSearchTokens, localMatches],
      chainServerId,
      excludedAddress
    );
  }, [
    baseTokens,
    chainServerId,
    excludedAddress,
    query,
    remoteSearchTokens,
    rpcSearchTokens,
  ]);

  return (
    <TokenSelector
      visible={visible}
      mainnetTokenList={displayTokens}
      isLoading={visible && searchLoading}
      onConfirm={onSelect}
      onCancel={onClose}
      onSearch={({ keyword }) => setQuery(keyword)}
      type={mode === 'sell' ? 'swapFrom' : 'swapTo'}
      placeholder="Search name, symbol, or contract address"
      chainId={chainServerId}
      supportChains={chain ? [chain.enum] : undefined}
      drawerHeight="min(540px, 90vh)"
      getContainer={getContainer}
      disableItemCheck={(token) => {
        const risky = isRiskyCowSwapToken(token);
        return {
          disable: risky,
          reason: risky ? 'Verify this token contract before using it' : '',
          shortReason: risky ? 'Unknown or suspicious token' : '',
        };
      }}
    />
  );
};

export default CowTokenSelector;
