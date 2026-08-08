import type { TokenItem } from '@/background/service/openapi';

jest.mock('@/utils/chain', () => {
  const chains = [
    [1, 'eth', 'ETH', 'ETH'],
    [56, 'bsc', 'BSC', 'BNB'],
    [100, 'xdai', 'XDAI', 'xDai'],
    [137, 'matic', 'MATIC', 'POL'],
    [8453, 'base', 'BASE', 'ETH'],
    [9745, 'plasma', 'PLASMA', 'XPL'],
    [42161, 'arb', 'ARBITRUM', 'ETH'],
    [43114, 'avax', 'AVALANCHE', 'AVAX'],
    [57073, 'ink', 'INK', 'ETH'],
    [59144, 'linea', 'LINEA', 'ETH'],
  ].map(([id, serverId, chainEnum, symbol]) => ({
    id,
    serverId,
    enum: chainEnum,
    name: serverId,
    nativeTokenAddress: serverId,
    nativeTokenSymbol: symbol,
    nativeTokenDecimals: 18,
    nativeTokenLogo: '',
  }));
  return {
    findChain: jest.fn(({ id, serverId }) =>
      chains.find(
        (chain) =>
          (id !== undefined && Number(chain.id) === Number(id)) ||
          (serverId !== undefined && chain.serverId === serverId)
      )
    ),
  };
});

import {
  COW_SWAP_CHAIN_CONFIG_BY_ID,
  COW_SWAP_NATIVE_TOKEN,
  COW_SWAP_SUPPORTED_CHAIN_IDS,
} from '@/constant/cow-swap';
import { findChain } from '@/utils/chain';
import {
  cowSwapMetadataToTokenItem,
  getCowSwapRouteTokenAddress,
  getCowSwapStandardTokens,
  getCowSwapTokenAddress,
  isRiskyCowSwapToken,
  matchesCowSwapTokenQuery,
  mergeCowSwapTokenLists,
} from '@/ui/views/Swap/cowSwapTokens';

const EXPECTED_DEFAULT_OUTPUTS: Record<number, string> = {
  1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  56: '0x55d398326f99059ff775485246999027b3197955',
  100: '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0',
  137: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  9745: '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb',
  42161: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  43114: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
  57073: '0x2d270e6886d130d724215a266106e6832161eaed',
  59144: '0x176211869ca2b568f2a7d4ee941e073a821ee1ff',
};

const token = (overrides: Partial<TokenItem> = {}): TokenItem => ({
  id: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  chain: 'eth',
  amount: 0,
  decimals: 18,
  display_symbol: 'WETH',
  is_core: true,
  is_verified: true,
  is_wallet: false,
  logo_url: '',
  name: 'Wrapped Ether',
  optimized_symbol: 'WETH',
  price: 0,
  symbol: 'WETH',
  time_at: 0,
  ...overrides,
});

describe('CoW token selection', () => {
  test('provides native, wrapped-native, and stable defaults on every chain', () => {
    for (const chainId of COW_SWAP_SUPPORTED_CHAIN_IDS) {
      const chain = findChain({ id: chainId })!;
      const config = COW_SWAP_CHAIN_CONFIG_BY_ID[chainId];
      const defaults = getCowSwapStandardTokens(chain.serverId);
      const addresses = defaults.map((item) =>
        getCowSwapTokenAddress(item, chain.serverId)
      );

      expect(config.defaultOutputToken).toBe(EXPECTED_DEFAULT_OUTPUTS[chainId]);
      expect(defaults).toHaveLength(3);
      expect(new Set(addresses).size).toBe(3);
      expect(addresses).toEqual([
        COW_SWAP_NATIVE_TOKEN,
        config.wrappedNativeToken,
        EXPECTED_DEFAULT_OUTPUTS[chainId],
      ]);
    }
  });

  test('maps wallet-native IDs and normalizes ERC-20 addresses', () => {
    expect(getCowSwapTokenAddress(token({ id: 'eth' }), 'eth')).toBe(
      COW_SWAP_NATIVE_TOKEN
    );
    expect(
      getCowSwapTokenAddress(
        token({ id: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }),
        'eth'
      )
    ).toBe('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
    expect(() =>
      getCowSwapTokenAddress(token({ chain: 'arb' }), 'eth')
    ).toThrow('selected chain');
    expect(() =>
      getCowSwapTokenAddress(token({ id: 'portfolio-project' }), 'eth')
    ).toThrow('contract address');
  });

  test('defaults only absent route tokens and rejects malformed values', () => {
    expect(getCowSwapRouteTokenAddress(null, 'eth')).toBe(
      COW_SWAP_NATIVE_TOKEN
    );
    expect(getCowSwapRouteTokenAddress('eth', 'eth')).toBe(
      COW_SWAP_NATIVE_TOKEN
    );
    expect(getCowSwapRouteTokenAddress('', 'eth')).toBeNull();
    expect(getCowSwapRouteTokenAddress('not-a-token', 'eth')).toBeNull();
    expect(getCowSwapRouteTokenAddress(null, 'unsupported')).toBeNull();
  });

  test('prefers wallet balances while deduplicating and excluding the other side', () => {
    const walletWeth = token({ amount: 2.5, price: 3_000 });
    const staticWeth = token({ amount: 0, price: 0 });
    const usdc = token({
      id: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amount: 100,
      decimals: 6,
      symbol: 'USDC',
    });
    const merged = mergeCowSwapTokenLists(
      [[walletWeth], [staticWeth, usdc]],
      'eth',
      usdc.id
    );

    expect(merged).toEqual([walletWeth]);
  });

  test('turns RPC-only contracts into searchable warned token rows', () => {
    const custom = cowSwapMetadataToTokenItem(
      {
        address: '0x0000000000000000000000000000000000000001',
        decimals: 6,
        symbol: 'CUSTOM',
        balance: '1234500',
      },
      'eth'
    );

    expect(custom.amount).toBe(1.2345);
    expect(isRiskyCowSwapToken(custom)).toBe(true);
    expect(matchesCowSwapTokenQuery(custom, 'custom')).toBe(true);
    expect(matchesCowSwapTokenQuery(custom, custom.id)).toBe(true);
  });

  test('requires confirmation for non-core and unclassified tokens', () => {
    expect(isRiskyCowSwapToken(token())).toBe(false);
    expect(isRiskyCowSwapToken(token({ is_core: false }))).toBe(true);
    expect(isRiskyCowSwapToken(token({ is_core: undefined }))).toBe(true);
  });
});
