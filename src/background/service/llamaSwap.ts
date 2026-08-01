import { ethers } from 'ethers';
import RPCService from './rpc';
import { findChain } from '@/utils/chain';
import {
  KYBERSWAP_ROUTER,
  LLAMASWAP_NATIVE_TOKEN,
} from '@/constant/llama-swap';

const LLAMASWAP_QUOTE_ENDPOINT =
  'https://swap-api.defillama.com/dexAggregatorQuote';
const LLAMASWAP_PUBLIC_FRONTEND_KEY = [
  'nsr_UYWxuvj1hOCgHxJhDEKZ0g30c4Be3I5',
  'fOMBtFAA',
].join('');

const LLAMASWAP_CHAIN_BY_SERVER_ID: Record<string, string> = {
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
  sonic: 'sonic',
  unichain: 'unichain',
};

const KYBERSWAP_INTERFACE = new ethers.utils.Interface([
  'function swap((address,address,bytes,(address,address,address[],uint256[],address[],uint256[],address,uint256,uint256,uint256,bytes),bytes)) payable returns (uint256)',
]);

export interface LlamaSwapToken {
  address: string;
  decimals: number;
  symbol?: string;
}

export interface LlamaSwapQuoteRequest {
  chainServerId: string;
  fromToken: LlamaSwapToken;
  toToken: LlamaSwapToken;
  amount: string;
  userAddress: string;
  slippage: string;
}

export interface ValidatedLlamaSwapQuote {
  provider: 'KyberSwap via LlamaSwap';
  chainServerId: string;
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut: string;
  minimumAmountOut: string;
  slippage: string;
  approvalSpender: string;
  estimatedGas: string;
  transaction: {
    from: string;
    to: string;
    data: string;
    value: string;
    gas?: string;
  };
  quoteId: string;
}

const normalizeTokenAddress = (address: string) =>
  address.toLowerCase() === LLAMASWAP_NATIVE_TOKEN
    ? LLAMASWAP_NATIVE_TOKEN
    : ethers.utils.getAddress(address).toLowerCase();

const assertIntegerString = (value: unknown, label: string) => {
  if (
    typeof value !== 'string' ||
    !/^\d+$/.test(value) ||
    BigInt(value) <= 0n
  ) {
    throw new Error(`Invalid LlamaSwap ${label}`);
  }
  return value;
};

const assertNonnegativeIntegerString = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`Invalid LlamaSwap ${label}`);
  }
  return value;
};

export const validateLlamaSwapQuote = (
  request: LlamaSwapQuoteRequest,
  response: any
): ValidatedLlamaSwapQuote => {
  const chain = LLAMASWAP_CHAIN_BY_SERVER_ID[request.chainServerId];
  if (!chain) throw new Error('LlamaSwap does not support this chain');

  const fromToken = normalizeTokenAddress(request.fromToken.address);
  const toToken = normalizeTokenAddress(request.toToken.address);
  if (fromToken === toToken) throw new Error('Swap tokens must be different');

  const userAddress = ethers.utils
    .getAddress(request.userAddress)
    .toLowerCase();
  const amountIn = assertIntegerString(request.amount, 'input amount');
  const slippage = Number(request.slippage);
  if (!Number.isFinite(slippage) || slippage < 0.1 || slippage > 10) {
    throw new Error('LlamaSwap slippage must be between 0.1% and 10%');
  }

  const amountOut = assertIntegerString(
    response?.amountReturned,
    'output amount'
  );
  const minimumAmountOut = (
    (BigInt(amountOut) * BigInt(Math.floor((100 - slippage) * 10_000))) /
    1_000_000n
  ).toString();
  const rawQuote = response?.rawQuote;
  if (!rawQuote || typeof rawQuote !== 'object') {
    throw new Error('LlamaSwap response is missing the raw quote');
  }
  if (String(rawQuote.amountIn) !== amountIn) {
    throw new Error('LlamaSwap input amount mismatch');
  }
  if (String(rawQuote.amountOut) !== amountOut) {
    throw new Error('LlamaSwap output amount mismatch');
  }

  const router = ethers.utils.getAddress(rawQuote.routerAddress).toLowerCase();
  const spender = ethers.utils
    .getAddress(response.tokenApprovalAddress)
    .toLowerCase();
  if (router !== KYBERSWAP_ROUTER || spender !== KYBERSWAP_ROUTER) {
    throw new Error('LlamaSwap returned an unapproved router or spender');
  }

  const data = String(rawQuote.data || '').toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(data) || data.length < 10) {
    throw new Error('LlamaSwap returned invalid calldata');
  }

  try {
    const execution = KYBERSWAP_INTERFACE.decodeFunctionData('swap', data)[0];
    const description = execution[3];
    const calldataFromToken = normalizeTokenAddress(description[0]);
    const calldataToToken = normalizeTokenAddress(description[1]);
    const calldataRecipient = ethers.utils
      .getAddress(description[6])
      .toLowerCase();
    if (
      calldataFromToken !== fromToken ||
      calldataToToken !== toToken ||
      calldataRecipient !== userAddress ||
      BigInt(description[7].toString()) !== BigInt(amountIn) ||
      BigInt(description[8].toString()) < BigInt(minimumAmountOut)
    ) {
      throw new Error('KyberSwap calldata does not match the reviewed quote');
    }
    const feeAmounts = description[5] as ethers.BigNumber[];
    if (feeAmounts.some((amount) => !amount.isZero())) {
      throw new Error('KyberSwap calldata contains an unexpected fee');
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('reviewed quote') ||
        error.message.includes('unexpected fee'))
    ) {
      throw error;
    }
    throw new Error('LlamaSwap returned undecodable KyberSwap calldata');
  }

  const value = assertNonnegativeIntegerString(
    String(rawQuote.transactionValue ?? '0'),
    'transaction value'
  );
  const expectedValue = fromToken === LLAMASWAP_NATIVE_TOKEN ? amountIn : '0';
  if (BigInt(value) !== BigInt(expectedValue)) {
    throw new Error('LlamaSwap native value mismatch');
  }

  if (Number(rawQuote.additionalCostUsd || 0) !== 0) {
    throw new Error('LlamaSwap returned an unexpected additional fee');
  }

  const estimatedGas = String(response.estimatedGas || rawQuote.gas || '');
  if (!/^\d+$/.test(estimatedGas) || BigInt(estimatedGas) <= 0n) {
    throw new Error('LlamaSwap returned invalid gas data');
  }

  const quoteMaterial = JSON.stringify({
    chain,
    fromToken,
    toToken,
    amountIn,
    amountOut,
    minimumAmountOut,
    userAddress,
    router,
    spender,
    data,
    value,
  });

  return {
    provider: 'KyberSwap via LlamaSwap',
    chainServerId: request.chainServerId,
    fromToken,
    toToken,
    amountIn,
    amountOut,
    minimumAmountOut,
    slippage: String(slippage),
    approvalSpender: spender,
    estimatedGas,
    transaction: {
      from: userAddress,
      to: router,
      data,
      value,
      gas: `0x${BigInt(estimatedGas).toString(16)}`,
    },
    quoteId: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(quoteMaterial)),
  };
};

export class LlamaSwapService {
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

  getTokenMetadata = async ({
    chainServerId,
    tokenAddress,
    ownerAddress,
  }: {
    chainServerId: string;
    tokenAddress: string;
    ownerAddress: string;
  }) => {
    const chain = findChain({ serverId: chainServerId });
    if (!chain) throw new Error('Unknown chain');
    const owner = ethers.utils.getAddress(ownerAddress);
    if (tokenAddress.toLowerCase() === LLAMASWAP_NATIVE_TOKEN) {
      return {
        address: LLAMASWAP_NATIVE_TOKEN,
        decimals: 18,
        symbol: chain.nativeTokenSymbol,
        balance: await this.requestRPC(chainServerId, 'eth_getBalance', [
          owner,
          'latest',
        ]),
      };
    }

    const token = ethers.utils.getAddress(tokenAddress);
    const balanceData = `0x70a08231${owner
      .toLowerCase()
      .slice(2)
      .padStart(64, '0')}`;
    const [decimalsRaw, symbolRaw, balanceRaw] = await Promise.all([
      this.requestRPC(chainServerId, 'eth_call', [
        { to: token, data: '0x313ce567' },
        'latest',
      ]),
      this.requestRPC(chainServerId, 'eth_call', [
        { to: token, data: '0x95d89b41' },
        'latest',
      ]).catch(() => '0x'),
      this.requestRPC(chainServerId, 'eth_call', [
        { to: token, data: balanceData },
        'latest',
      ]),
    ]);
    const decimals = Number(BigInt(decimalsRaw));
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new Error('Token returned invalid decimals');
    }
    let symbol = 'TOKEN';
    try {
      symbol = ethers.utils.defaultAbiCoder.decode(['string'], symbolRaw)[0];
    } catch {
      try {
        symbol =
          ethers.utils.toUtf8String(symbolRaw).replace(/\0+$/g, '') || symbol;
      } catch {
        // Keep the local fallback label.
      }
    }
    return {
      address: token.toLowerCase(),
      decimals,
      symbol: String(symbol).slice(0, 32),
      balance: balanceRaw,
    };
  };

  getQuote = async (
    request: LlamaSwapQuoteRequest
  ): Promise<ValidatedLlamaSwapQuote> => {
    const chain = LLAMASWAP_CHAIN_BY_SERVER_ID[request.chainServerId];
    if (!chain) throw new Error('LlamaSwap does not support this chain');

    const from = normalizeTokenAddress(request.fromToken.address);
    const to = normalizeTokenAddress(request.toToken.address);
    const params = new URLSearchParams({
      protocol: 'KyberSwap',
      chain,
      from,
      to,
      amount: request.amount,
      api_key: LLAMASWAP_PUBLIC_FRONTEND_KEY,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(`${LLAMASWAP_QUOTE_ENDPOINT}?${params}`, {
        method: 'POST',
        body: JSON.stringify({
          userAddress: request.userAddress,
          slippage: request.slippage,
          isPrivacyEnabled: true,
          fromToken: {
            address: from,
            decimals: request.fromToken.decimals,
          },
          toToken: {
            address: to,
            decimals: request.toToken.decimals,
          },
        }),
        credentials: 'include',
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `LlamaSwap quote failed (${response.status}): ${body.slice(0, 160)}`
        );
      }
      return validateLlamaSwapQuote(request, await response.json());
    } finally {
      clearTimeout(timeout);
    }
  };
}

export default new LlamaSwapService();
