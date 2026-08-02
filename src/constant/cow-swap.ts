export interface CowSwapChainConfig {
  chainId: number;
  apiBaseUrl: string;
  explorerBaseUrl: string;
  settlementContract: string;
  vaultRelayer: string;
  ethFlowContract: string;
  wrappedNativeToken: string;
  defaultOutputToken: string;
}

// Fixed protocol values from CoW Protocol's current official SDK config and
// deployed EthFlow/GPv2 contracts. Keeping them explicit prevents a dependency
// update from silently changing a signing domain or approval target.
export const COW_SWAP_NATIVE_TOKEN =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
export const COW_SWAP_MAX_VALID_TO = 0xffffffff;
export const COW_SWAP_APP_DATA_VERSION = '1.15.0';

const COW_SETTLEMENT_CONTRACT = '0x9008d19f58aabd9ed0d60971565aa8510560ab41';
const COW_VAULT_RELAYER = '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110';
const COW_ETH_FLOW = '0xba3cb449bd2b4adddbc894d8697f5170800eadec';

export const COW_SWAP_DOMAIN_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
};

export const COW_SWAP_ORDER_TYPES = {
  Order: [
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken', type: 'address' },
    { name: 'receiver', type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'buyAmount', type: 'uint256' },
    { name: 'validTo', type: 'uint32' },
    { name: 'appData', type: 'bytes32' },
    { name: 'feeAmount', type: 'uint256' },
    { name: 'kind', type: 'string' },
    { name: 'partiallyFillable', type: 'bool' },
    { name: 'sellTokenBalance', type: 'string' },
    { name: 'buyTokenBalance', type: 'string' },
  ],
};

export const COW_SWAP_CANCELLATION_TYPES = {
  OrderCancellations: [{ name: 'orderUids', type: 'bytes[]' }],
};

const EVM_CHAIN_IDS = [
  1, // Ethereum
  56, // BNB Chain
  100, // Gnosis Chain
  137, // Polygon
  8453, // Base
  9745, // Plasma
  42161, // Arbitrum One
  43114, // Avalanche
  57073, // Ink
  59144, // Linea
] as const;

const EXPLORER_BASE_URL_BY_CHAIN_ID: Record<number, string> = {
  1: 'https://explorer.cow.fi',
  56: 'https://explorer.cow.fi/bnb',
  100: 'https://explorer.cow.fi/gc',
  137: 'https://explorer.cow.fi/pol',
  8453: 'https://explorer.cow.fi/base',
  9745: 'https://explorer.cow.fi/plasma',
  42161: 'https://explorer.cow.fi/arb1',
  43114: 'https://explorer.cow.fi/avax',
  57073: 'https://explorer.cow.fi/ink',
  59144: 'https://explorer.cow.fi/linea',
};

// Documented production order-book servers:
// https://github.com/cowprotocol/services/blob/main/crates/orderbook/openapi.yml
const API_BASE_URL_BY_CHAIN_ID: Record<number, string> = {
  1: 'https://api.cow.fi/mainnet',
  56: 'https://api.cow.fi/bnb',
  100: 'https://api.cow.fi/xdai',
  137: 'https://api.cow.fi/polygon',
  8453: 'https://api.cow.fi/base',
  9745: 'https://api.cow.fi/plasma',
  42161: 'https://api.cow.fi/arbitrum_one',
  43114: 'https://api.cow.fi/avalanche',
  57073: 'https://api.cow.fi/ink',
  59144: 'https://api.cow.fi/linea',
};

const WRAPPED_NATIVE_TOKEN_BY_CHAIN_ID: Record<number, string> = {
  1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
  100: '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d', // WXDAI
  137: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WPOL
  8453: '0x4200000000000000000000000000000000000006', // WETH
  9745: '0x6100e367285b01f48d07953803a2d8dca5d19873', // WXPL
  42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', // WETH
  43114: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', // WAVAX
  57073: '0x4200000000000000000000000000000000000006', // WETH
  59144: '0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f', // WETH
};

// Defaults come from CoW Swap's production token list at
// https://files.cow.fi/tokens/CowSwap.json. They are convenience values only;
// token metadata and balances are always read from the selected RPC.
const DEFAULT_OUTPUT_TOKEN_BY_CHAIN_ID: Record<number, string> = {
  1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  56: '0x55d398326f99059ff775485246999027b3197955', // USDT
  100: '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0', // USDC.e
  137: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // USDC
  8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
  9745: '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb', // USDT0
  42161: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC
  43114: '0xb97ef9ef8734f71904d8002f8b6bc66dd9c48a6e', // USDC
  57073: '0x2d270e6886d130d724215a266106e6832161eaed', // USDC
  59144: '0x176211869ca2b568f2a7d4ee941e073a821ee1ff', // USDC
};

const normalizeRequiredAddress = (
  value: string | undefined,
  label: string,
  chainId: number
) => {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Missing ${label} for CoW Swap chain ${chainId}`);
  }
  return value.toLowerCase();
};

const buildChainConfig = (chainId: number): CowSwapChainConfig => {
  const apiBaseUrl = API_BASE_URL_BY_CHAIN_ID[chainId];
  const wrappedNativeToken = WRAPPED_NATIVE_TOKEN_BY_CHAIN_ID[chainId];
  const explorerBaseUrl = EXPLORER_BASE_URL_BY_CHAIN_ID[chainId];
  const defaultOutputToken = DEFAULT_OUTPUT_TOKEN_BY_CHAIN_ID[chainId];
  if (
    !apiBaseUrl ||
    !/^https:\/\/api\.cow\.fi\/[a-z0-9_]+$/.test(apiBaseUrl) ||
    !explorerBaseUrl ||
    !defaultOutputToken
  ) {
    throw new Error(`Incomplete CoW Swap configuration for chain ${chainId}`);
  }

  return {
    chainId,
    apiBaseUrl,
    explorerBaseUrl,
    settlementContract: normalizeRequiredAddress(
      COW_SETTLEMENT_CONTRACT,
      'settlement contract',
      chainId
    ),
    vaultRelayer: normalizeRequiredAddress(
      COW_VAULT_RELAYER,
      'vault relayer',
      chainId
    ),
    ethFlowContract: normalizeRequiredAddress(
      COW_ETH_FLOW,
      'EthFlow contract',
      chainId
    ),
    wrappedNativeToken: normalizeRequiredAddress(
      wrappedNativeToken,
      'wrapped native token',
      chainId
    ),
    defaultOutputToken: normalizeRequiredAddress(
      defaultOutputToken,
      'default output token',
      chainId
    ),
  };
};

export const COW_SWAP_CHAIN_CONFIG_BY_ID: Record<
  number,
  CowSwapChainConfig
> = Object.fromEntries(
  EVM_CHAIN_IDS.map((chainId) => [chainId, buildChainConfig(chainId)])
);

export const COW_SWAP_SUPPORTED_CHAIN_IDS = [...EVM_CHAIN_IDS] as number[];
export const COW_SWAP_API_BASE_URLS = new Set(
  Object.values(COW_SWAP_CHAIN_CONFIG_BY_ID).map((item) => item.apiBaseUrl)
);
