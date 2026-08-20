import { ethers } from 'ethers';
import type { TokenItem } from '@/background/service/openapi';
import type { CowSwapTokenMetadata } from '@/background/service/cowSwap';
import {
  COW_SWAP_CHAIN_CONFIG_BY_ID,
  COW_SWAP_NATIVE_TOKEN,
} from '@/constant/cow-swap';
import { findChain } from '@/utils/chain';

interface StandardTokenLabels {
  wrapped: { symbol: string; name: string; decimals: number };
  output: { symbol: string; name: string; decimals: number };
}

const STANDARD_TOKEN_LABELS: Record<number, StandardTokenLabels> = {
  1: {
    wrapped: { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    output: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  },
  56: {
    wrapped: { symbol: 'WBNB', name: 'Wrapped BNB', decimals: 18 },
    output: { symbol: 'USDT', name: 'Tether USD', decimals: 18 },
  },
  100: {
    wrapped: { symbol: 'WXDAI', name: 'Wrapped xDai', decimals: 18 },
    output: { symbol: 'USDC.e', name: 'Bridged USDC', decimals: 6 },
  },
  137: {
    wrapped: { symbol: 'WPOL', name: 'Wrapped POL', decimals: 18 },
    output: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  },
  8453: {
    wrapped: { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    output: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  },
  9745: {
    wrapped: { symbol: 'WXPL', name: 'Wrapped XPL', decimals: 18 },
    output: { symbol: 'USDT0', name: 'USDT0', decimals: 6 },
  },
  42161: {
    wrapped: { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    output: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  },
  43114: {
    wrapped: { symbol: 'WAVAX', name: 'Wrapped AVAX', decimals: 18 },
    output: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  },
  57073: {
    wrapped: { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    output: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  },
  59144: {
    wrapped: { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    output: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  },
};

const makeTokenItem = ({
  id,
  chain,
  symbol,
  name,
  decimals,
  logoUrl = '',
}: {
  id: string;
  chain: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}): TokenItem => ({
  id,
  chain,
  amount: 0,
  decimals,
  display_symbol: symbol,
  is_core: true,
  is_verified: true,
  is_wallet: false,
  logo_url: logoUrl,
  name,
  optimized_symbol: symbol,
  price: 0,
  symbol,
  time_at: 0,
});

export const getCowSwapRouteTokenAddress = (
  value: string | null,
  chainServerId: string
) => {
  const chain = findChain({ serverId: chainServerId });
  if (!chain) return null;
  if (value === null) return COW_SWAP_NATIVE_TOKEN;
  if (
    value.toLowerCase() === chain.nativeTokenAddress.toLowerCase() ||
    value.toLowerCase() === COW_SWAP_NATIVE_TOKEN
  ) {
    return COW_SWAP_NATIVE_TOKEN;
  }
  return ethers.utils.isAddress(value)
    ? ethers.utils.getAddress(value).toLowerCase()
    : null;
};

export const getCowSwapTokenAddress = (
  token: Pick<TokenItem, 'chain' | 'id'>,
  chainServerId: string
) => {
  const chain = findChain({ serverId: chainServerId });
  if (!chain || token.chain !== chainServerId) {
    throw new Error('Token does not belong to the selected chain');
  }
  if (
    token.id === COW_SWAP_NATIVE_TOKEN ||
    token.id.toLowerCase() === chain.nativeTokenAddress.toLowerCase()
  ) {
    return COW_SWAP_NATIVE_TOKEN;
  }
  if (!ethers.utils.isAddress(token.id)) {
    throw new Error('Token does not have a valid contract address');
  }
  return ethers.utils.getAddress(token.id).toLowerCase();
};

export const getCowSwapStandardTokens = (
  chainServerId: string
): TokenItem[] => {
  const chain = findChain({ serverId: chainServerId });
  const chainId = Number(chain?.id);
  const config = COW_SWAP_CHAIN_CONFIG_BY_ID[chainId];
  const labels = STANDARD_TOKEN_LABELS[chainId];
  if (!chain || !config || !labels) return [];

  return [
    makeTokenItem({
      id: chain.nativeTokenAddress,
      chain: chainServerId,
      symbol: chain.nativeTokenSymbol,
      name: chain.nativeTokenSymbol,
      decimals: chain.nativeTokenDecimals,
      logoUrl: chain.nativeTokenLogo,
    }),
    makeTokenItem({
      id: config.wrappedNativeToken,
      chain: chainServerId,
      ...labels.wrapped,
      logoUrl: chain.nativeTokenLogo,
    }),
    makeTokenItem({
      id: config.defaultOutputToken,
      chain: chainServerId,
      ...labels.output,
    }),
  ];
};

export const mergeCowSwapTokenLists = (
  tokenLists: TokenItem[][],
  chainServerId: string,
  excludedAddress?: string
) => {
  const result: TokenItem[] = [];
  const seen = new Set<string>();
  for (const token of tokenLists.flat()) {
    try {
      const address = getCowSwapTokenAddress(token, chainServerId);
      if (address === excludedAddress?.toLowerCase() || seen.has(address)) {
        continue;
      }
      seen.add(address);
      result.push(token);
    } catch {
      // Portfolio APIs can contain project IDs that are not fungible tokens.
    }
  }
  return result;
};

export const matchesCowSwapTokenQuery = (token: TokenItem, query: string) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    token.id,
    token.name,
    token.symbol,
    token.display_symbol,
    token.optimized_symbol,
  ].some((value) => value?.toLowerCase().includes(normalized));
};

export const isRiskyCowSwapToken = (token: TokenItem) =>
  token.is_verified === false ||
  token.is_core !== true ||
  Boolean(token.is_suspicious) ||
  Boolean(token.is_scam);

export const cowSwapMetadataToTokenItem = (
  metadata: CowSwapTokenMetadata,
  chainServerId: string,
  source?: TokenItem
): TokenItem => {
  const chain = findChain({ serverId: chainServerId });
  if (!chain) throw new Error('Selected chain is unavailable');
  const isNative = metadata.address === COW_SWAP_NATIVE_TOKEN;
  const formattedBalance = ethers.utils.formatUnits(
    metadata.balance,
    metadata.decimals
  );
  const numericBalance = Number(formattedBalance);
  const symbol = metadata.symbol;

  return {
    ...(source || ({} as TokenItem)),
    id: isNative ? chain.nativeTokenAddress : metadata.address,
    chain: chainServerId,
    amount: Number.isFinite(numericBalance) ? numericBalance : 0,
    decimals: metadata.decimals,
    display_symbol: symbol,
    is_core: source?.is_core ?? isNative,
    is_verified: source?.is_verified ?? isNative,
    is_wallet: source?.is_wallet ?? false,
    logo_url: source?.logo_url || (isNative ? chain.nativeTokenLogo : ''),
    name: source?.name || symbol,
    optimized_symbol: symbol,
    price: source?.price || 0,
    symbol,
    time_at: source?.time_at || 0,
  };
};
