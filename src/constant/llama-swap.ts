export const LLAMASWAP_NATIVE_TOKEN =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export const ONEINCH_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65';
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
  sonic: LLAMASWAP_PROTOCOLS,
  unichain: LLAMASWAP_PROTOCOLS,
};
