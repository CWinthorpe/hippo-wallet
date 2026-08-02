export const LLAMASWAP_NATIVE_TOKEN =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export const ONEINCH_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65';
export const ONEINCH_ZKSYNC_ROUTER =
  '0x6fd4383cb451173d5f9304f041c7bcbf27d561ff';
export const KYBERSWAP_ROUTER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5';
export const PARASWAP_ROUTER = '0x6a000f20005980200259b80c5102003040001068';
export const PARASWAP_LLAMASWAP_PARTNER =
  '0x08a3c2a819e3de7aca384c798269b3ce1cd0e437';
export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3';
export const ZEROX_SETTLER_DEPLOYER =
  '0x00000000000004533fe15556b1e086bb1a72ceae';
export const ZEROX_TAKER_SUBMITTED_FEATURE = 2;
export const ZEROX_LLAMASWAP_AFFILIATE =
  '0x2e72c00000000000000000000000000000000000';
export const MATCHA_PROTOCOL = 'Matcha/0x v2' as const;

export const LLAMASWAP_PROTOCOLS = [
  '1inch',
  'KyberSwap',
  'ParaSwap',
  MATCHA_PROTOCOL,
] as const;

export type LlamaSwapProtocol = typeof LLAMASWAP_PROTOCOLS[number];

/**
 * Wallet server IDs mapped to the network names consumed by LlamaSwap's
 * production frontend adapters. Only chains present in Hippo's chain registry
 * are listed; the frontend-only Robinhood chain is omitted until Hippo ships it.
 */
export const LLAMASWAP_CHAIN_BY_SERVER_ID: Record<string, string> = {
  eth: 'ethereum',
  bsc: 'bsc',
  matic: 'polygon',
  op: 'optimism',
  arb: 'arbitrum',
  avax: 'avax',
  xdai: 'gnosis',
  era: 'zksync',
  base: 'base',
  linea: 'linea',
  mnt: 'mantle',
  scrl: 'scroll',
  mode: 'mode',
  world: 'worldchain',
  sonic: 'sonic',
  ink: 'ink',
  bera: 'berachain',
  uni: 'unichain',
  hyper: 'hyperevm',
  plasma: 'plasma',
  monad: 'monad',
  megaeth: 'megaeth',
  tempo: 'tempo',
};

export const ONEINCH_ROUTER_BY_LLAMA_CHAIN: Record<string, string> = {
  ethereum: ONEINCH_ROUTER,
  bsc: ONEINCH_ROUTER,
  polygon: ONEINCH_ROUTER,
  optimism: ONEINCH_ROUTER,
  arbitrum: ONEINCH_ROUTER,
  gnosis: ONEINCH_ROUTER,
  avax: ONEINCH_ROUTER,
  zksync: ONEINCH_ZKSYNC_ROUTER,
  base: ONEINCH_ROUTER,
  sonic: ONEINCH_ROUTER,
  unichain: ONEINCH_ROUTER,
  linea: ONEINCH_ROUTER,
};

/**
 * Mirrors the ordinary transaction adapters exposed by the LlamaSwap frontend.
 * The separate `0x Gasless` adapter is deliberately excluded: Hippo does not
 * support relayed, sponsored, or gasless submission.
 */
export const LLAMASWAP_PROTOCOLS_BY_CHAIN: Record<
  string,
  readonly LlamaSwapProtocol[]
> = {
  eth: LLAMASWAP_PROTOCOLS,
  bsc: LLAMASWAP_PROTOCOLS,
  matic: LLAMASWAP_PROTOCOLS,
  op: LLAMASWAP_PROTOCOLS,
  arb: LLAMASWAP_PROTOCOLS,
  avax: LLAMASWAP_PROTOCOLS,
  xdai: ['1inch', 'ParaSwap'],
  era: ['1inch'],
  base: LLAMASWAP_PROTOCOLS,
  linea: ['1inch', 'KyberSwap', 'Matcha/0x v2'],
  mnt: ['Matcha/0x v2'],
  scrl: ['Matcha/0x v2'],
  mode: ['Matcha/0x v2'],
  world: ['Matcha/0x v2'],
  sonic: LLAMASWAP_PROTOCOLS,
  ink: ['Matcha/0x v2'],
  bera: ['KyberSwap', 'Matcha/0x v2'],
  uni: LLAMASWAP_PROTOCOLS,
  hyper: ['KyberSwap', 'Matcha/0x v2'],
  plasma: ['KyberSwap', 'Matcha/0x v2'],
  monad: ['KyberSwap', 'Matcha/0x v2'],
  megaeth: ['KyberSwap'],
  tempo: ['Matcha/0x v2'],
};
