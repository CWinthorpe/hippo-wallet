import { ethers } from 'ethers';
import { findChain } from '@/utils/chain';
import {
  COW_SWAP_APP_DATA_VERSION,
  COW_SWAP_CANCELLATION_TYPES,
  COW_SWAP_CHAIN_CONFIG_BY_ID,
  COW_SWAP_DOMAIN_TYPES,
  COW_SWAP_MAX_VALID_TO,
  COW_SWAP_NATIVE_TOKEN,
  COW_SWAP_ORDER_TYPES,
} from '@/constant/cow-swap';
import type { CowSwapChainConfig } from '@/constant/cow-swap';
import RPCService from './rpc';
import { fetchCowSwapApi } from './cowSwapTransport';
import type {
  CowSwapTransport,
  CowSwapTransportResponse,
} from './cowSwapTransport';

const QUOTE_VALID_FOR_SECONDS = 10 * 60;
const MIN_QUOTE_REMAINING_SECONDS = 20;
const MAX_QUOTE_VALIDITY_SECONDS = 15 * 60;
const MAX_NATIVE_QUOTE_EXPIRATION_SECONDS = 4 * 60 * 60;
const MAX_STORED_QUOTES = 64;
const MAX_STORED_CANCELLATIONS = 32;
const CONTRACT_VERIFICATION_TTL_MS = 10 * 60 * 1000;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_SIGNED_INT64 = (1n << 63n) - 1n;
const MAX_ESTIMATED_GAS = 5_000_000n;
const ORDER_UID_PATTERN = /^0x[0-9a-f]{112}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const TERMINAL_ORDER_STATUSES = new Set(['fulfilled', 'cancelled', 'expired']);
const VALID_ORDER_STATUSES = new Set([
  'presignaturePending',
  'open',
  ...TERMINAL_ORDER_STATUSES,
]);

const ETH_FLOW_INTERFACE = new ethers.utils.Interface([
  'function createOrder((address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,bytes32 appData,uint256 feeAmount,uint32 validTo,bool partiallyFillable,int64 quoteId) order) payable returns (bytes32 orderHash)',
  'function invalidateOrder((address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,bytes32 appData,uint256 feeAmount,uint32 validTo,bool partiallyFillable,int64 quoteId) order)',
  'function orders(bytes32 orderHash) view returns (address owner,uint32 validTo)',
]);

export interface CowSwapTokenMetadata {
  address: string;
  decimals: number;
  symbol: string;
  balance: string;
}

export interface CowSwapQuoteRequest {
  chainServerId: string;
  fromToken: {
    address: string;
    decimals: number;
    symbol: string;
  };
  toToken: {
    address: string;
    decimals: number;
    symbol: string;
  };
  amount: string;
  userAddress: string;
  slippage: string;
}

export interface CowSwapOrderMessage {
  sellToken: string;
  buyToken: string;
  receiver: string;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  appData: string;
  feeAmount: string;
  kind: 'sell';
  partiallyFillable: false;
  sellTokenBalance: 'erc20';
  buyTokenBalance: 'erc20';
}

export interface CowSwapTypedData {
  domain: {
    name: 'Gnosis Protocol';
    version: 'v2';
    chainId: number;
    verifyingContract: string;
  };
  primaryType: 'Order';
  types: Record<string, Array<{ name: string; type: string }>>;
  message: CowSwapOrderMessage;
}

export interface ValidatedCowSwapQuote {
  provider: 'CoW Swap';
  quoteHandle: string;
  quoteId: number;
  chainServerId: string;
  chainId: number;
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut: string;
  minimumAmountOut: string;
  networkFeeAmount: string;
  protocolFeeBps: number;
  slippageBps: number;
  approvalSpender: string | null;
  nativeSell: boolean;
  expectedOrderUid: string;
  expiresAt: number;
  explorerUrl: string;
  signingPayload: CowSwapTypedData | null;
}

export interface CowSwapOrderStatus {
  orderUid: string;
  status:
    | 'notFound'
    | 'presignaturePending'
    | 'open'
    | 'fulfilled'
    | 'cancelled'
    | 'expired';
  owner: string | null;
  sender: string | null;
  creationDate: string | null;
  validTo: number | null;
  executedSellAmount: string;
  executedBuyAmount: string;
  executedFeeAmount: string;
  settlementTxHash: string | null;
  refundTxHash: string | null;
  isNativeSell: boolean;
  terminal: boolean;
  explorerUrl: string;
}

interface EthFlowOrderData {
  buyToken: string;
  receiver: string;
  sellAmount: string;
  buyAmount: string;
  appData: string;
  feeAmount: string;
  validTo: number;
  partiallyFillable: false;
  quoteId: number;
}

interface CowSwapTransaction {
  from: string;
  to: string;
  data: string;
  value: string;
  gas: string;
}

interface StoredQuote {
  publicQuote: ValidatedCowSwapQuote;
  config: CowSwapChainConfig;
  owner: string;
  order: CowSwapOrderMessage;
  fullAppData: string;
  expiresAt: number;
  used: boolean;
  nativeTransaction?: CowSwapTransaction;
  ethFlowOrder?: EthFlowOrderData;
}

interface StoredCancellation {
  chainServerId: string;
  config: CowSwapChainConfig;
  owner: string;
  orderUid: string;
  typedData: {
    domain: CowSwapTypedData['domain'];
    primaryType: 'OrderCancellations';
    types: Record<string, Array<{ name: string; type: string }>>;
    message: { orderUids: string[] };
  };
  expiresAt: number;
  used: boolean;
}

interface ParsedApiOrder extends Record<string, any> {
  uid: string;
  owner: string;
  status: string;
  sellToken: string;
  buyToken: string;
  receiver: string;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  appData: string;
  appDataHash?: string;
  feeAmount: string;
  kind: string;
  partiallyFillable: boolean;
  sellTokenBalance: string;
  buyTokenBalance: string;
}

const isPlainRecord = (value: unknown): value is Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const normalizeAddress = (value: unknown, label: string) => {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}`);
  try {
    return ethers.utils.getAddress(value).toLowerCase();
  } catch {
    throw new Error(`Invalid ${label}`);
  }
};

const normalizeTokenAddress = (value: unknown, label: string) => {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}`);
  if (/^(native|eth)$/i.test(value.trim())) return COW_SWAP_NATIVE_TOKEN;
  return normalizeAddress(value, label);
};

const parseUintString = (
  value: unknown,
  label: string,
  options: { allowZero?: boolean; max?: bigint } = {}
) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const parsed = BigInt(value);
  if (!options.allowZero && parsed === 0n) throw new Error(`Invalid ${label}`);
  if (parsed > (options.max ?? MAX_UINT256))
    throw new Error(`Invalid ${label}`);
  return parsed;
};

const parseRpcQuantity = (
  value: unknown,
  label: string,
  options: { allowZero?: boolean; max?: bigint } = {}
) => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const parsed = BigInt(value);
  if (!options.allowZero && parsed === 0n) throw new Error(`Invalid ${label}`);
  if (parsed > (options.max ?? MAX_UINT256))
    throw new Error(`Invalid ${label}`);
  return parsed;
};

const parseSafeInteger = (
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
) => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
};

const parseCowApiTimestamp = (value: unknown) => {
  if (typeof value !== 'string') return Number.NaN;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(
    value
  );
  if (!match) return Number.NaN;
  const milliseconds = (match[2] || '0').padEnd(3, '0').slice(0, 3);
  const parsed = Date.parse(`${match[1]}.${milliseconds}Z`);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 19) !== match[1]
  ) {
    return Number.NaN;
  }
  return parsed;
};

const parseSlippageBps = (value: string) => {
  const match = value.trim().match(/^(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('Slippage must be a decimal percentage');
  const bps = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isInteger(bps) || bps < 1 || bps > 5_000) {
    throw new Error('Slippage must be between 0.01% and 50%');
  }
  return bps;
};

const safeApiText = (value: unknown) => {
  return typeof value === 'string'
    ? value
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, 300)
    : '';
};

const parseJson = (text: string, label: string) => {
  if (!text) throw new Error(`${label} returned an empty response`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
};

const apiError = (label: string, response: CowSwapTransportResponse) => {
  let parsed: any;
  try {
    parsed = response.text ? JSON.parse(response.text) : undefined;
  } catch {
    parsed = undefined;
  }
  const errorType = safeApiText(parsed?.errorType || parsed?.error);
  const description = safeApiText(parsed?.description || parsed?.message);
  const detail = [errorType, description].filter(Boolean).join(': ');
  return Object.assign(
    new Error(
      `${label} failed (${response.status})${detail ? `: ${detail}` : ''}`
    ),
    {
      status: response.status,
      apiErrorType: errorType || undefined,
      definitive: response.status >= 400 && response.status < 500,
    }
  );
};

const buildAppData = (slippageBps: number) => {
  const fullAppData = JSON.stringify({
    appCode: 'Hippo Wallet',
    environment: 'production',
    metadata: {
      orderClass: { orderClass: 'market' },
      quote: { slippageBips: slippageBps },
    },
    version: COW_SWAP_APP_DATA_VERSION,
  });
  return {
    fullAppData,
    appDataHash: ethers.utils
      .keccak256(ethers.utils.toUtf8Bytes(fullAppData))
      .toLowerCase(),
  };
};

const buildDomain = (config: CowSwapChainConfig) => ({
  name: 'Gnosis Protocol' as const,
  version: 'v2' as const,
  chainId: config.chainId,
  verifyingContract: config.settlementContract,
});

const withoutDomainType = (
  types: Record<string, Array<{ name: string; type: string }>>
) => {
  const { EIP712Domain: _domainType, ...messageTypes } = types;
  return messageTypes;
};

const buildOrderUid = (
  config: CowSwapChainConfig,
  order: CowSwapOrderMessage,
  owner: string,
  validTo = order.validTo
) => {
  const digest = ethers.utils._TypedDataEncoder.hash(
    buildDomain(config),
    COW_SWAP_ORDER_TYPES,
    { ...order, validTo }
  );
  const uid = ethers.utils
    .solidityPack(['bytes32', 'address', 'uint32'], [digest, owner, validTo])
    .toLowerCase();
  if (!ORDER_UID_PATTERN.test(uid))
    throw new Error('Failed to build CoW order UID');
  return uid;
};

const parseOrderUid = (value: unknown) => {
  if (typeof value !== 'string') throw new Error('Invalid CoW order UID');
  const uid = value.toLowerCase();
  if (!ORDER_UID_PATTERN.test(uid)) throw new Error('Invalid CoW order UID');
  return {
    uid,
    owner: `0x${uid.slice(66, 106)}`,
    validTo: Number.parseInt(uid.slice(106), 16),
  };
};

const resolveAppDataHash = (order: Record<string, any>) => {
  if (typeof order.appDataHash === 'string') {
    const hash = order.appDataHash.toLowerCase();
    if (!HASH_PATTERN.test(hash))
      throw new Error('Invalid order app-data hash');
    if (typeof order.appData === 'string' && order.appData.startsWith('{')) {
      const calculated = ethers.utils
        .keccak256(ethers.utils.toUtf8Bytes(order.appData))
        .toLowerCase();
      if (calculated !== hash) throw new Error('Order app-data hash mismatch');
    }
    return hash;
  }
  if (typeof order.appData === 'string') {
    const hash = order.appData.toLowerCase();
    if (HASH_PATTERN.test(hash)) return hash;
  }
  throw new Error('Order is missing a valid app-data hash');
};

const validateApiOrder = (
  value: unknown,
  config: CowSwapChainConfig,
  expectedUid: string
): ParsedApiOrder => {
  if (!isPlainRecord(value)) throw new Error('CoW order response is malformed');
  const uid = parseOrderUid(value.uid).uid;
  if (uid !== expectedUid) throw new Error('CoW order UID mismatch');
  const owner = normalizeAddress(value.owner, 'order owner');
  const status = safeApiText(value.status);
  if (!VALID_ORDER_STATUSES.has(status))
    throw new Error('Invalid CoW order status');
  const sellToken = normalizeAddress(value.sellToken, 'order sell token');
  const buyToken = normalizeAddress(value.buyToken, 'order buy token');
  const receiver = normalizeAddress(value.receiver, 'order receiver');
  const sellAmount = parseUintString(
    value.sellAmount,
    'order sell amount'
  ).toString();
  const buyAmount = parseUintString(
    value.buyAmount,
    'order buy amount'
  ).toString();
  const feeAmount = parseUintString(value.feeAmount, 'order fee amount', {
    allowZero: true,
  }).toString();
  const validTo = parseSafeInteger(
    value.validTo,
    'order validity',
    0,
    0xffffffff
  );
  const appData = resolveAppDataHash(value);
  if (
    value.kind !== 'sell' ||
    value.partiallyFillable !== false ||
    value.sellTokenBalance !== 'erc20' ||
    value.buyTokenBalance !== 'erc20'
  ) {
    throw new Error('Unexpected CoW order execution parameters');
  }
  const reconstructed: CowSwapOrderMessage = {
    sellToken,
    buyToken,
    receiver,
    sellAmount,
    buyAmount,
    validTo,
    appData,
    feeAmount,
    kind: 'sell',
    partiallyFillable: false,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20',
  };
  const calculatedUid = buildOrderUid(config, reconstructed, owner, validTo);
  if (calculatedUid !== uid)
    throw new Error('CoW order payload does not match UID');
  return {
    ...value,
    uid,
    owner,
    status,
    sellToken,
    buyToken,
    receiver,
    sellAmount,
    buyAmount,
    validTo,
    appData,
    feeAmount,
  } as ParsedApiOrder;
};

const toHexQuantity = (value: bigint) =>
  ethers.utils.hexValue(ethers.BigNumber.from(value.toString()));

export class CowSwapService {
  private readonly quotes = new Map<string, StoredQuote>();
  private readonly cancellations = new Map<string, StoredCancellation>();
  private readonly contractVerification = new Map<string, number>();

  constructor(private readonly transport: CowSwapTransport = fetchCowSwapApi) {}

  private requestRPC = async (
    chainServerId: string,
    method: string,
    params: any[]
  ) => {
    const chain = findChain({ serverId: chainServerId });
    if (!chain) throw new Error('Unknown chain');
    if (RPCService.hasCustomRPC(chain.enum)) {
      return RPCService.requestCustomRPC(chain.enum, method, params);
    }
    return RPCService.requestDefaultRPC({
      chainServerId,
      method,
      params,
    });
  };

  private resolveChain = (chainServerId: string) => {
    const chain = findChain({ serverId: chainServerId });
    const chainId = Number(chain?.id);
    const config = COW_SWAP_CHAIN_CONFIG_BY_ID[chainId];
    if (!chain || !config)
      throw new Error('CoW Swap does not support this chain');
    return { chain, config };
  };

  private pruneState = () => {
    const now = Date.now();
    for (const [handle, state] of this.quotes) {
      if (state.expiresAt <= now || state.used) this.quotes.delete(handle);
    }
    for (const [handle, state] of this.cancellations) {
      if (state.expiresAt <= now || state.used)
        this.cancellations.delete(handle);
    }
    while (this.quotes.size >= MAX_STORED_QUOTES) {
      this.quotes.delete(this.quotes.keys().next().value);
    }
    while (this.cancellations.size >= MAX_STORED_CANCELLATIONS) {
      this.cancellations.delete(this.cancellations.keys().next().value);
    }
  };

  private newHandle = () => {
    return ethers.utils.hexlify(ethers.utils.randomBytes(32)).toLowerCase();
  };

  private verifyProtocolContracts = async (
    chainServerId: string,
    config: CowSwapChainConfig,
    includeEthFlow: boolean
  ) => {
    const cacheKey = `${config.chainId}:${
      includeEthFlow ? 'ethflow' : 'erc20'
    }`;
    if ((this.contractVerification.get(cacheKey) || 0) > Date.now()) return;
    const addresses = [
      config.settlementContract,
      config.vaultRelayer,
      ...(includeEthFlow
        ? [config.ethFlowContract, config.wrappedNativeToken]
        : []),
    ];
    const codes = await Promise.all(
      addresses.map((address) =>
        this.requestRPC(chainServerId, 'eth_getCode', [address, 'latest'])
      )
    );
    codes.forEach((code, index) => {
      if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) {
        throw new Error(`Selected RPC found no code at ${addresses[index]}`);
      }
    });
    this.contractVerification.set(
      cacheKey,
      Date.now() + CONTRACT_VERIFICATION_TTL_MS
    );
  };

  getTokenMetadata = async ({
    chainServerId,
    tokenAddress,
    ownerAddress,
  }: {
    chainServerId: string;
    tokenAddress: string;
    ownerAddress: string;
  }): Promise<CowSwapTokenMetadata> => {
    const { chain } = this.resolveChain(chainServerId);
    const owner = normalizeAddress(ownerAddress, 'token owner');
    const normalizedToken = normalizeTokenAddress(
      tokenAddress,
      'token address'
    );
    if (normalizedToken === COW_SWAP_NATIVE_TOKEN) {
      return {
        address: COW_SWAP_NATIVE_TOKEN,
        decimals: 18,
        symbol: chain.nativeTokenSymbol,
        balance: parseRpcQuantity(
          await this.requestRPC(chainServerId, 'eth_getBalance', [
            owner,
            'latest',
          ]),
          'native balance',
          { allowZero: true }
        ).toString(),
      };
    }

    const code = await this.requestRPC(chainServerId, 'eth_getCode', [
      normalizedToken,
      'latest',
    ]);
    if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) {
      throw new Error('Token address has no contract code on the selected RPC');
    }
    const balanceData = `0x70a08231${owner.slice(2).padStart(64, '0')}`;
    const [decimalsRaw, symbolRaw, balanceRaw] = await Promise.all([
      this.requestRPC(chainServerId, 'eth_call', [
        { to: normalizedToken, data: '0x313ce567' },
        'latest',
      ]),
      this.requestRPC(chainServerId, 'eth_call', [
        { to: normalizedToken, data: '0x95d89b41' },
        'latest',
      ]).catch(() => '0x'),
      this.requestRPC(chainServerId, 'eth_call', [
        { to: normalizedToken, data: balanceData },
        'latest',
      ]),
    ]);
    const decimalsBigInt = parseRpcQuantity(decimalsRaw, 'token decimals', {
      allowZero: true,
      max: 255n,
    });
    const decimals = Number(decimalsBigInt);
    const balance = parseRpcQuantity(balanceRaw, 'token balance', {
      allowZero: true,
    }).toString();
    let symbol = 'TOKEN';
    try {
      symbol = String(
        ethers.utils.defaultAbiCoder.decode(['string'], symbolRaw)[0]
      );
    } catch {
      try {
        symbol = ethers.utils.toUtf8String(symbolRaw).replace(/\0+$/g, '');
      } catch {
        // Keep a local generic label when the token has no standard symbol.
      }
    }
    symbol = [...symbol]
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 31 && code !== 127;
      })
      .join('')
      .trim()
      .slice(0, 32);
    return {
      address: normalizedToken,
      decimals,
      symbol: symbol || 'TOKEN',
      balance,
    };
  };

  private getOrderResponse = async (
    config: CowSwapChainConfig,
    orderUid: string
  ): Promise<CowSwapTransportResponse> => {
    return this.transport({
      url: `${config.apiBaseUrl}/api/v1/orders/${orderUid}`,
      method: 'GET',
      timeoutMs: 10_000,
    });
  };

  private orderExists = async (
    config: CowSwapChainConfig,
    orderUid: string
  ) => {
    const response = await this.getOrderResponse(config, orderUid);
    if (response.status === 404) return false;
    if (response.status < 200 || response.status >= 300) {
      throw apiError('CoW order lookup', response);
    }
    validateApiOrder(
      parseJson(response.text, 'CoW order lookup'),
      config,
      orderUid
    );
    return true;
  };

  private estimateTransactionGas = async (
    chainServerId: string,
    transaction: Omit<CowSwapTransaction, 'gas'>
  ) => {
    const raw = await this.requestRPC(chainServerId, 'eth_estimateGas', [
      transaction,
    ]);
    const estimate = parseRpcQuantity(raw, 'gas estimate');
    if (estimate > MAX_ESTIMATED_GAS) {
      throw new Error('CoW transaction gas estimate exceeds the safety limit');
    }
    const withMargin = (estimate * 120n + 99n) / 100n;
    return toHexQuantity(withMargin);
  };

  private buildEthFlowTransaction = async (
    chainServerId: string,
    config: CowSwapChainConfig,
    owner: string,
    ethFlowOrder: EthFlowOrderData
  ): Promise<CowSwapTransaction> => {
    const transactionWithoutGas = {
      from: owner,
      to: config.ethFlowContract,
      data: ETH_FLOW_INTERFACE.encodeFunctionData('createOrder', [
        ethFlowOrder,
      ]).toLowerCase(),
      value: toHexQuantity(BigInt(ethFlowOrder.sellAmount)),
    };
    return {
      ...transactionWithoutGas,
      gas: await this.estimateTransactionGas(
        chainServerId,
        transactionWithoutGas
      ),
    };
  };

  getQuote = async (
    request: CowSwapQuoteRequest
  ): Promise<ValidatedCowSwapQuote> => {
    this.pruneState();
    if (!isPlainRecord(request)) throw new Error('Invalid CoW quote request');
    const { config } = this.resolveChain(request.chainServerId);
    const owner = normalizeAddress(request.userAddress, 'swap account');
    const fromToken = normalizeTokenAddress(
      request.fromToken?.address,
      'sell token'
    );
    const toToken = normalizeTokenAddress(
      request.toToken?.address,
      'buy token'
    );
    if (fromToken === toToken)
      throw new Error('Sell and buy tokens must differ');
    const amount = parseUintString(request.amount, 'sell amount');
    const slippageBps = parseSlippageBps(request.slippage);
    const requestedFromDecimals = parseSafeInteger(
      request.fromToken?.decimals,
      'sell token decimals',
      0,
      255
    );
    const requestedToDecimals = parseSafeInteger(
      request.toToken?.decimals,
      'buy token decimals',
      0,
      255
    );
    const [actualFromToken, actualToToken, ownerCode] = await Promise.all([
      this.getTokenMetadata({
        chainServerId: request.chainServerId,
        tokenAddress: fromToken,
        ownerAddress: owner,
      }),
      this.getTokenMetadata({
        chainServerId: request.chainServerId,
        tokenAddress: toToken,
        ownerAddress: owner,
      }),
      this.requestRPC(request.chainServerId, 'eth_getCode', [owner, 'latest']),
    ]);
    if (
      actualFromToken.decimals !== requestedFromDecimals ||
      actualToToken.decimals !== requestedToDecimals
    ) {
      throw new Error('Token decimals do not match the selected RPC');
    }
    if (amount > BigInt(actualFromToken.balance)) {
      throw new Error('Sell amount exceeds the selected account balance');
    }

    const nativeSell = fromToken === COW_SWAP_NATIVE_TOKEN;
    if (
      !nativeSell &&
      (typeof ownerCode !== 'string' || !/^0x(?:00)*$/i.test(ownerCode))
    ) {
      throw new Error(
        'CoW off-chain order signing currently requires an externally owned account'
      );
    }
    await this.verifyProtocolContracts(
      request.chainServerId,
      config,
      nativeSell
    );

    const quoteSellToken = nativeSell ? config.wrappedNativeToken : fromToken;
    const { fullAppData, appDataHash } = buildAppData(slippageBps);
    const quoteRequest = {
      sellToken: quoteSellToken,
      buyToken: toToken,
      receiver: owner,
      from: owner,
      sellAmountBeforeFee: amount.toString(),
      kind: 'sell',
      validFor: QUOTE_VALID_FOR_SECONDS,
      appData: fullAppData,
      appDataHash,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
      priceQuality: 'optimal',
      signingScheme: nativeSell ? 'eip1271' : 'eip712',
      ...(nativeSell ? { onchainOrder: true, verificationGasLimit: 0 } : {}),
    };
    const quoteResponse = await this.transport({
      url: `${config.apiBaseUrl}/api/v1/quote`,
      method: 'POST',
      body: JSON.stringify(quoteRequest),
    });
    if (quoteResponse.status < 200 || quoteResponse.status >= 300) {
      throw apiError('CoW quote', quoteResponse);
    }
    const body = parseJson(quoteResponse.text, 'CoW quote');
    if (!isPlainRecord(body) || !isPlainRecord(body.quote)) {
      throw new Error('CoW quote response is malformed');
    }
    const rawQuote = body.quote;
    const quoteId = parseSafeInteger(body.id, 'CoW quote ID', 0);
    if (BigInt(quoteId) > MAX_SIGNED_INT64)
      throw new Error('Invalid CoW quote ID');
    if (body.verified !== true) throw new Error('CoW quote was not verified');
    if (normalizeAddress(body.from, 'quote owner') !== owner) {
      throw new Error('CoW quote owner mismatch');
    }
    if (
      normalizeAddress(rawQuote.sellToken, 'quoted sell token') !==
        quoteSellToken ||
      normalizeAddress(rawQuote.buyToken, 'quoted buy token') !== toToken ||
      normalizeAddress(rawQuote.receiver, 'quoted receiver') !== owner ||
      rawQuote.appData !== fullAppData ||
      String(rawQuote.appDataHash).toLowerCase() !== appDataHash ||
      rawQuote.kind !== 'sell' ||
      rawQuote.partiallyFillable !== false ||
      rawQuote.sellTokenBalance !== 'erc20' ||
      rawQuote.buyTokenBalance !== 'erc20' ||
      rawQuote.signingScheme !== (nativeSell ? 'eip1271' : 'eip712')
    ) {
      throw new Error(
        'CoW quote execution parameters do not match the request'
      );
    }
    const sellAmountAfterCosts = parseUintString(
      rawQuote.sellAmount,
      'quoted sell amount'
    );
    const amountOut = parseUintString(rawQuote.buyAmount, 'quoted buy amount');
    const networkFee = parseUintString(
      rawQuote.feeAmount,
      'quoted network fee',
      { allowZero: true }
    );
    parseUintString(rawQuote.gasAmount, 'quoted gas amount', {
      allowZero: true,
    });
    parseUintString(rawQuote.gasPrice, 'quoted gas price', {
      allowZero: true,
    });
    parseUintString(rawQuote.sellTokenPrice, 'quoted sell token price');
    const validTo = parseSafeInteger(
      rawQuote.validTo,
      'quoted validity',
      0,
      0xffffffff
    );
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      validTo < nowSeconds + MIN_QUOTE_REMAINING_SECONDS ||
      validTo > nowSeconds + MAX_QUOTE_VALIDITY_SECONDS
    ) {
      throw new Error('CoW quote validity is outside the accepted window');
    }
    const expiration = parseCowApiTimestamp(body.expiration);
    if (
      !Number.isFinite(expiration) ||
      expiration < Date.now() + MIN_QUOTE_REMAINING_SECONDS * 1000 ||
      expiration >
        Date.now() +
          (nativeSell
            ? MAX_NATIVE_QUOTE_EXPIRATION_SECONDS
            : MAX_QUOTE_VALIDITY_SECONDS) *
            1000
    ) {
      throw new Error('CoW quote expiration is outside the accepted window');
    }
    let protocolFeeBps = 0;
    if (body.protocolFeeBps !== undefined) {
      if (
        typeof body.protocolFeeBps !== 'string' ||
        !/^(0|[1-9][0-9]*)$/.test(body.protocolFeeBps)
      ) {
        throw new Error('Invalid CoW protocol fee');
      }
      protocolFeeBps = Number(body.protocolFeeBps);
      if (
        !Number.isSafeInteger(protocolFeeBps) ||
        protocolFeeBps < 0 ||
        protocolFeeBps > 10_000
      ) {
        throw new Error('Invalid CoW protocol fee');
      }
    }

    if (sellAmountAfterCosts + networkFee !== amount) {
      throw new Error('CoW quote does not preserve the exact sell amount');
    }
    // CoW's official sell-order implementation subtracts the floored
    // slippage amount from the post-fee buy amount. This rounds the user's
    // minimum output upward by at most one token atom.
    const slippageAmount = (amountOut * BigInt(slippageBps)) / BigInt(10_000);
    const minimumAmountOut = amountOut - slippageAmount;
    if (minimumAmountOut <= 0n || minimumAmountOut > amountOut) {
      throw new Error('CoW quote returned an invalid minimum output');
    }

    let order: CowSwapOrderMessage = {
      sellToken: quoteSellToken,
      buyToken: toToken,
      receiver: owner,
      sellAmount: amount.toString(),
      buyAmount: minimumAmountOut.toString(),
      validTo,
      appData: appDataHash,
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
    };
    let expectedOrderUid: string;
    let nativeTransaction: CowSwapTransaction | undefined;
    let ethFlowOrder: EthFlowOrderData | undefined;
    if (nativeSell) {
      for (let attempt = 0; ; attempt++) {
        expectedOrderUid = buildOrderUid(
          config,
          order,
          config.ethFlowContract,
          COW_SWAP_MAX_VALID_TO
        );
        if (!(await this.orderExists(config, expectedOrderUid))) break;
        if (attempt >= 4 || BigInt(order.buyAmount) <= 1n) {
          throw new Error('Unable to construct a unique CoW EthFlow order');
        }
        order = {
          ...order,
          buyAmount: (BigInt(order.buyAmount) - 1n).toString(),
        };
      }
      ethFlowOrder = {
        buyToken: order.buyToken,
        receiver: owner,
        sellAmount: order.sellAmount,
        buyAmount: order.buyAmount,
        appData: order.appData,
        feeAmount: order.feeAmount,
        validTo: order.validTo,
        partiallyFillable: false,
        quoteId,
      };
      nativeTransaction = await this.buildEthFlowTransaction(
        request.chainServerId,
        config,
        owner,
        ethFlowOrder
      );
      const nativeBalance = BigInt(actualFromToken.balance);
      if (nativeBalance < BigInt(nativeTransaction.value)) {
        throw new Error('Native balance is below the EthFlow deposit value');
      }
    } else {
      expectedOrderUid = buildOrderUid(config, order, owner);
    }

    const expiresAt = Math.min(expiration, validTo * 1000);
    const quoteHandle = this.newHandle();
    const publicQuote: ValidatedCowSwapQuote = {
      provider: 'CoW Swap',
      quoteHandle,
      quoteId,
      chainServerId: request.chainServerId,
      chainId: config.chainId,
      fromToken,
      toToken,
      amountIn: amount.toString(),
      amountOut: amountOut.toString(),
      minimumAmountOut: order.buyAmount,
      networkFeeAmount: networkFee.toString(),
      protocolFeeBps,
      slippageBps,
      approvalSpender: nativeSell ? null : config.vaultRelayer,
      nativeSell,
      expectedOrderUid,
      expiresAt,
      explorerUrl: `${config.explorerBaseUrl}/orders/${expectedOrderUid}`,
      signingPayload: nativeSell
        ? null
        : {
            domain: buildDomain(config),
            primaryType: 'Order',
            types: {
              ...COW_SWAP_DOMAIN_TYPES,
              ...COW_SWAP_ORDER_TYPES,
            },
            message: order,
          },
    };
    this.quotes.set(quoteHandle, {
      publicQuote,
      config,
      owner,
      order,
      fullAppData,
      expiresAt,
      used: false,
      nativeTransaction,
      ethFlowOrder,
    });
    return publicQuote;
  };

  private consumeQuote = (
    quoteHandle: string,
    chainServerId: string,
    userAddress: string,
    nativeSell: boolean
  ) => {
    this.pruneState();
    if (typeof quoteHandle !== 'string' || !HASH_PATTERN.test(quoteHandle)) {
      throw new Error('Invalid CoW quote handle');
    }
    const state = this.quotes.get(quoteHandle);
    if (!state || state.used)
      throw new Error('CoW quote is unavailable or already used');
    const owner = normalizeAddress(userAddress, 'swap account');
    if (
      state.owner !== owner ||
      state.publicQuote.chainServerId !== chainServerId ||
      state.publicQuote.nativeSell !== nativeSell
    ) {
      throw new Error('CoW quote context mismatch');
    }
    if (
      state.expiresAt < Date.now() + MIN_QUOTE_REMAINING_SECONDS * 1000 ||
      state.order.validTo <
        Math.floor(Date.now() / 1000) + MIN_QUOTE_REMAINING_SECONDS
    ) {
      this.quotes.delete(quoteHandle);
      throw new Error('CoW quote expired; request a fresh quote');
    }
    return state;
  };

  consumeNativeOrder = async ({
    quoteHandle,
    chainServerId,
    userAddress,
  }: {
    quoteHandle: string;
    chainServerId: string;
    userAddress: string;
  }) => {
    const state = this.consumeQuote(
      quoteHandle,
      chainServerId,
      userAddress,
      true
    );
    if (!state.nativeTransaction || !state.ethFlowOrder) {
      throw new Error('CoW EthFlow transaction is missing');
    }
    if (
      await this.orderExists(state.config, state.publicQuote.expectedOrderUid)
    ) {
      throw new Error('An identical CoW EthFlow order already exists; refresh');
    }
    state.used = true;
    return {
      orderUid: state.publicQuote.expectedOrderUid,
      explorerUrl: state.publicQuote.explorerUrl,
      transaction: { ...state.nativeTransaction },
    };
  };

  submitOrder = async ({
    quoteHandle,
    chainServerId,
    userAddress,
    signature,
  }: {
    quoteHandle: string;
    chainServerId: string;
    userAddress: string;
    signature: string;
  }) => {
    const state = this.consumeQuote(
      quoteHandle,
      chainServerId,
      userAddress,
      false
    );
    if (!SIGNATURE_PATTERN.test(signature)) {
      throw new Error('Invalid CoW order signature');
    }
    let recovered: string;
    try {
      recovered = ethers.utils
        .verifyTypedData(
          buildDomain(state.config),
          COW_SWAP_ORDER_TYPES,
          state.order,
          signature
        )
        .toLowerCase();
    } catch {
      throw new Error('Invalid CoW order signature');
    }
    if (recovered !== state.owner) {
      throw new Error(
        'CoW order signature does not recover the active account'
      );
    }
    state.used = true;
    const orderBody = {
      ...state.order,
      from: state.owner,
      signature,
      signingScheme: 'eip712',
      quoteId: state.publicQuote.quoteId,
      appData: state.fullAppData,
      appDataHash: state.order.appData,
      fullBalanceCheck: true,
    };
    const recoverExpectedOrder = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const recoveredOrder = await this.fetchAndValidateOrder(
            state.config,
            state.publicQuote.expectedOrderUid
          );
          if (recoveredOrder) return true;
        } catch {
          // A status lookup failure cannot prove that the submission failed.
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      }
      return false;
    };
    let response: CowSwapTransportResponse;
    try {
      response = await this.transport({
        url: `${state.config.apiBaseUrl}/api/v1/orders`,
        method: 'POST',
        body: JSON.stringify(orderBody),
      });
    } catch {
      const recovered = await recoverExpectedOrder();
      return {
        orderUid: state.publicQuote.expectedOrderUid,
        explorerUrl: state.publicQuote.explorerUrl,
        status: recovered ? ('open' as const) : ('ambiguous' as const),
      };
    }
    if (response.status < 200 || response.status >= 300) {
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        const recovered = await recoverExpectedOrder();
        return {
          orderUid: state.publicQuote.expectedOrderUid,
          explorerUrl: state.publicQuote.explorerUrl,
          status: recovered ? ('open' as const) : ('ambiguous' as const),
        };
      }
      throw apiError('CoW order submission', response);
    }
    let orderUid: string;
    try {
      const returnedUid = parseJson(response.text, 'CoW order submission');
      orderUid = parseOrderUid(returnedUid).uid;
    } catch {
      const recovered = await recoverExpectedOrder();
      return {
        orderUid: state.publicQuote.expectedOrderUid,
        explorerUrl: state.publicQuote.explorerUrl,
        status: recovered ? ('open' as const) : ('ambiguous' as const),
      };
    }
    if (orderUid !== state.publicQuote.expectedOrderUid) {
      const recovered = await recoverExpectedOrder();
      return {
        orderUid: state.publicQuote.expectedOrderUid,
        explorerUrl: state.publicQuote.explorerUrl,
        status: recovered ? ('open' as const) : ('ambiguous' as const),
      };
    }
    return {
      orderUid,
      explorerUrl: state.publicQuote.explorerUrl,
      status: 'open' as const,
    };
  };

  private fetchAndValidateOrder = async (
    config: CowSwapChainConfig,
    orderUid: string
  ): Promise<ParsedApiOrder | null> => {
    const response = await this.getOrderResponse(config, orderUid);
    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300) {
      throw apiError('CoW order status', response);
    }
    return validateApiOrder(
      parseJson(response.text, 'CoW order status'),
      config,
      orderUid
    );
  };

  getOrderStatus = async ({
    chainServerId,
    orderUid: rawOrderUid,
    ownerAddress,
  }: {
    chainServerId: string;
    orderUid: string;
    ownerAddress: string;
  }): Promise<CowSwapOrderStatus> => {
    const { config } = this.resolveChain(chainServerId);
    const { uid: orderUid, owner: uidOwner } = parseOrderUid(rawOrderUid);
    const expectedOwner = normalizeAddress(ownerAddress, 'order account');
    const explorerUrl = `${config.explorerBaseUrl}/orders/${orderUid}`;
    const order = await this.fetchAndValidateOrder(config, orderUid);
    if (!order) {
      return {
        orderUid,
        status: 'notFound',
        owner: null,
        sender: null,
        creationDate: null,
        validTo: null,
        executedSellAmount: '0',
        executedBuyAmount: '0',
        executedFeeAmount: '0',
        settlementTxHash: null,
        refundTxHash: null,
        isNativeSell: uidOwner === config.ethFlowContract,
        terminal: false,
        explorerUrl,
      };
    }
    const isNativeSell = uidOwner === config.ethFlowContract;
    const sender = order.onchainOrderData?.sender
      ? normalizeAddress(order.onchainOrderData.sender, 'on-chain order sender')
      : null;
    if (
      (!isNativeSell && order.owner !== expectedOwner) ||
      (isNativeSell && sender !== expectedOwner)
    ) {
      throw new Error('CoW order does not belong to the active account');
    }
    if (order.owner !== uidOwner) {
      throw new Error('CoW order owner does not match its UID');
    }
    const creationDate = safeApiText(order.creationDate) || null;
    const settlementTxHash = order.txHash
      ? String(order.txHash).toLowerCase()
      : null;
    if (settlementTxHash && !/^0x[0-9a-f]{64}$/.test(settlementTxHash)) {
      throw new Error('Invalid CoW settlement transaction hash');
    }
    const refundTxHash = order.ethflowData?.refundTxHash
      ? String(order.ethflowData.refundTxHash).toLowerCase()
      : null;
    if (refundTxHash && !/^0x[0-9a-f]{64}$/.test(refundTxHash)) {
      throw new Error('Invalid CoW refund transaction hash');
    }
    const executedSellAmount = parseUintString(
      order.executedSellAmount || '0',
      'executed sell amount',
      { allowZero: true }
    ).toString();
    const executedBuyAmount = parseUintString(
      order.executedBuyAmount || '0',
      'executed buy amount',
      { allowZero: true }
    ).toString();
    const executedFeeAmount = parseUintString(
      order.executedFeeAmount || '0',
      'executed fee amount',
      { allowZero: true }
    ).toString();
    return {
      orderUid,
      status: order.status as CowSwapOrderStatus['status'],
      owner: order.owner,
      sender,
      creationDate,
      validTo: isNativeSell
        ? parseSafeInteger(
            order.ethflowData?.userValidTo,
            'EthFlow user validity',
            0,
            0xffffffff
          )
        : order.validTo,
      executedSellAmount,
      executedBuyAmount,
      executedFeeAmount,
      settlementTxHash,
      refundTxHash,
      isNativeSell,
      terminal:
        TERMINAL_ORDER_STATUSES.has(order.status) &&
        !(isNativeSell && order.status === 'expired' && !refundTxHash),
      explorerUrl,
    };
  };

  private buildCancellationTransaction = async (
    chainServerId: string,
    config: CowSwapChainConfig,
    owner: string,
    order: ParsedApiOrder
  ) => {
    const userValidTo = parseSafeInteger(
      order.ethflowData?.userValidTo,
      'EthFlow user validity',
      0,
      0xffffffff
    );
    const ethFlowOrder: EthFlowOrderData = {
      buyToken: order.buyToken,
      receiver: order.receiver,
      sellAmount: order.sellAmount,
      buyAmount: order.buyAmount,
      appData: resolveAppDataHash(order),
      feeAmount: order.feeAmount,
      validTo: userValidTo,
      partiallyFillable: false,
      // Quote ID and validity do not participate in EthFlow invalidation hashing.
      quoteId: 0,
    };
    const transactionWithoutGas = {
      from: owner,
      to: config.ethFlowContract,
      data: ETH_FLOW_INTERFACE.encodeFunctionData('invalidateOrder', [
        ethFlowOrder,
      ]).toLowerCase(),
      value: '0x0',
    };
    return {
      ...transactionWithoutGas,
      gas: await this.estimateTransactionGas(
        chainServerId,
        transactionWithoutGas
      ),
    };
  };

  private verifyEthFlowOrderOwner = async (
    chainServerId: string,
    config: CowSwapChainConfig,
    orderUid: string,
    expectedOwner: string,
    expectedValidTo: number
  ) => {
    const orderDigest = `0x${orderUid.slice(2, 66)}`;
    const result = await this.requestRPC(chainServerId, 'eth_call', [
      {
        to: config.ethFlowContract,
        data: ETH_FLOW_INTERFACE.encodeFunctionData('orders', [orderDigest]),
      },
      'latest',
    ]);
    let decoded: ethers.utils.Result;
    try {
      decoded = ETH_FLOW_INTERFACE.decodeFunctionResult('orders', result);
    } catch {
      throw new Error('Invalid EthFlow ownership response');
    }
    const onchainOwner = normalizeAddress(decoded.owner, 'EthFlow order owner');
    const onchainValidTo = parseSafeInteger(
      decoded.validTo,
      'EthFlow order validity',
      0,
      0xffffffff
    );
    if (onchainOwner !== expectedOwner || onchainValidTo !== expectedValidTo) {
      throw new Error('EthFlow on-chain order ownership mismatch');
    }
  };

  prepareCancellation = async ({
    chainServerId,
    orderUid: rawOrderUid,
    ownerAddress,
  }: {
    chainServerId: string;
    orderUid: string;
    ownerAddress: string;
  }) => {
    this.pruneState();
    const { config } = this.resolveChain(chainServerId);
    const { uid: orderUid, owner: uidOwner } = parseOrderUid(rawOrderUid);
    const owner = normalizeAddress(ownerAddress, 'order account');
    const order = await this.fetchAndValidateOrder(config, orderUid);
    if (!order) throw new Error('CoW order was not found');
    const isEthFlowOrder = uidOwner === config.ethFlowContract;
    const canCancel =
      order.status === 'open' ||
      order.status === 'presignaturePending' ||
      (isEthFlowOrder && order.status === 'expired');
    if (!canCancel) {
      throw new Error(
        `CoW order cannot be cancelled from status ${order.status}`
      );
    }

    if (isEthFlowOrder) {
      const sender = normalizeAddress(
        order.onchainOrderData?.sender,
        'on-chain order sender'
      );
      if (sender !== owner) throw new Error('EthFlow order account mismatch');
      const userValidTo = parseSafeInteger(
        order.ethflowData?.userValidTo,
        'EthFlow user validity',
        0,
        0xffffffff
      );
      await this.verifyEthFlowOrderOwner(
        chainServerId,
        config,
        orderUid,
        owner,
        userValidTo
      );
      return {
        type: 'transaction' as const,
        orderUid,
        transaction: await this.buildCancellationTransaction(
          chainServerId,
          config,
          owner,
          order
        ),
      };
    }
    if (uidOwner !== owner || order.owner !== owner) {
      throw new Error('CoW order account mismatch');
    }
    const cancellationHandle = this.newHandle();
    const typedData = {
      domain: buildDomain(config),
      primaryType: 'OrderCancellations' as const,
      types: {
        ...COW_SWAP_DOMAIN_TYPES,
        ...COW_SWAP_CANCELLATION_TYPES,
      },
      message: { orderUids: [orderUid] },
    };
    this.cancellations.set(cancellationHandle, {
      chainServerId,
      config,
      owner,
      orderUid,
      typedData,
      expiresAt: Date.now() + 2 * 60 * 1000,
      used: false,
    });
    return {
      type: 'signature' as const,
      orderUid,
      cancellationHandle,
      signingPayload: typedData,
    };
  };

  submitCancellation = async ({
    cancellationHandle,
    chainServerId,
    ownerAddress,
    signature,
  }: {
    cancellationHandle: string;
    chainServerId: string;
    ownerAddress: string;
    signature: string;
  }) => {
    this.pruneState();
    if (
      typeof cancellationHandle !== 'string' ||
      !HASH_PATTERN.test(cancellationHandle)
    ) {
      throw new Error('Invalid CoW cancellation handle');
    }
    const state = this.cancellations.get(cancellationHandle);
    if (!state || state.used || state.expiresAt <= Date.now()) {
      throw new Error('CoW cancellation is unavailable or expired');
    }
    const owner = normalizeAddress(ownerAddress, 'order account');
    if (state.chainServerId !== chainServerId || state.owner !== owner) {
      throw new Error('CoW cancellation context mismatch');
    }
    if (!SIGNATURE_PATTERN.test(signature)) {
      throw new Error('Invalid CoW cancellation signature');
    }
    let recovered: string;
    try {
      recovered = ethers.utils
        .verifyTypedData(
          state.typedData.domain,
          withoutDomainType(state.typedData.types),
          state.typedData.message,
          signature
        )
        .toLowerCase();
    } catch {
      throw new Error('Invalid CoW cancellation signature');
    }
    if (recovered !== owner) {
      throw new Error('CoW cancellation signature account mismatch');
    }
    state.used = true;
    const confirmCancellation = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const order = await this.fetchAndValidateOrder(
            state.config,
            state.orderUid
          );
          if (
            order &&
            order.status !== 'open' &&
            order.status !== 'presignaturePending'
          ) {
            return order.status as 'cancelled' | 'fulfilled' | 'expired';
          }
        } catch {
          // A failed lookup cannot prove whether cancellation reached the API.
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      return 'ambiguous' as const;
    };
    let response: CowSwapTransportResponse;
    try {
      response = await this.transport({
        url: `${state.config.apiBaseUrl}/api/v1/orders`,
        method: 'DELETE',
        body: JSON.stringify({
          orderUids: [state.orderUid],
          signature,
          signingScheme: 'eip712',
        }),
      });
    } catch {
      return {
        orderUid: state.orderUid,
        status: await confirmCancellation(),
      };
    }
    if (response.status < 200 || response.status >= 300) {
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        return {
          orderUid: state.orderUid,
          status: await confirmCancellation(),
        };
      }
      throw apiError('CoW order cancellation', response);
    }
    return {
      orderUid: state.orderUid,
      status: await confirmCancellation(),
    };
  };
}

export const __cowSwapTestUtils = {
  parseSlippageBps,
  buildAppData,
  buildOrderUid,
  parseOrderUid,
  validateApiOrder,
  ETH_FLOW_INTERFACE,
};

export default new CowSwapService();
